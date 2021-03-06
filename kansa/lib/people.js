const config = require('./config');
const { setKeyChecked } = require('./key');
const { AuthError, InputError } = require('./errors');
const { mailTask, updateMailRecipient } = require('./mail')
const LogEntry = require('./types/logentry');
const Person = require('./types/person');

const selectAllPeopleData = `
  SELECT p.*, preferred_name(p), d.status AS daypass, daypass_days(d)
    FROM people p LEFT JOIN daypasses d ON (p.id = d.person_id)`

module.exports = {
  selectAllPeopleData,
  getMemberEmails, getMemberPaperPubs, getPeople, getPerson, getAllPrevNames, getPrevNames,
  addPerson, authAddPerson, updatePerson
};

function getPeopleQuery(req, res, next) {
  const cond = Object.keys(req.query).map(fn => { switch(fn) {
    case 'since':
      return 'last_modified > $(since)';
    case 'name':
      return '(legal_name ILIKE $(name) OR public_first_name ILIKE $(name) OR public_last_name ILIKE $(name))';
    case 'member_number':
    case 'membership':
    case 'hugo_nominator':
    case 'hugo_voter':
      return `${fn} = $(${fn})`;
    default:
      return (Person.fields.indexOf(fn) !== -1) ? `${fn} ILIKE $(${fn})` : 'true';
  }});
  req.app.locals.db.any(`${selectAllPeopleData} WHERE ${cond.join(' AND ')}`, req.query)
    .then(data => res.status(200).json(data))
    .catch(err => next(err));
}

function getMemberEmails(req, res, next) {
  if (!req.session.user.member_admin) return res.status(401).json({ status: 'unauthorized' });
  req.app.locals.db.any(`
      SELECT lower(email) AS email, legal_name AS ln, public_first_name AS pfn, public_last_name AS pln
        FROM People
       WHERE email != '' AND membership != 'NonMember'
    ORDER BY public_last_name, public_first_name, legal_name`
  )
    .then(raw => {
      const namesByEmail = raw.reduce((map, {email, ln, pfn, pln}) => {
        const name = [pfn, pln].filter(n => n).join(' ').replace(/  +/g, ' ').trim() || ln.trim();
        if (map[email]) map[email].push(name);
        else map[email] = [name];
        return map;
      }, {});
      const getCombinedName = (names) => {
        switch (names.length) {
          case 0: return '';
          case 1: return names[0];
          case 2: return `${names[0]} and ${names[1]}`;
          default:
            names[names.length - 1] = `and ${names[names.length - 1]}`;
            return names.join(', ');
        }
      };
      const data = Object.keys(namesByEmail).map(email => {
        const name = getCombinedName(namesByEmail[email]);
        return { email, name };
      });
      res.status(200).csv(data, true);
    })
    .catch(next);
}

function getMemberPaperPubs(req, res, next) {
  if (!req.session.user.member_admin) return res.status(401).json({ status: 'unauthorized' });
  req.app.locals.db.any(`
        SELECT paper_pubs->>'name' AS name,
               paper_pubs->>'address' AS address,
               paper_pubs->>'country' AS country
          FROM People
         WHERE paper_pubs IS NOT NULL AND membership != 'NonMember'`
  )
    .then(data => {
      res.status(200).csv(data, true);
    })
    .catch(next);
}

function getPeople(req, res, next) {
  if (!req.session.user.member_admin && !req.session.user.member_list) {
    return res.status(401).json({ status: 'unauthorized' });
  }
  if (Object.keys(req.query).length > 0) getPeopleQuery(req, res, next);
  else req.app.locals.db.any(selectAllPeopleData)
    .then(data => {
      const maxId = data.reduce((m, p) => Math.max(m, p.id), -1);
      if (isNaN(maxId)) {
        res.status(500).json({ status: 'error', message: 'Contains non-numeric id?', data });
      } else {
        const arr = new Array(maxId + 1);
        data.forEach(p => {
          arr[p.id] = Person.fields.reduce((o, fn) => {
            const v = p[fn];
            if (v !== null && v !== false) o[fn] = v;
            return o;
          }, { id: p.id });
        });
        res.status(200).json(arr);
      }
    })
    .catch(err => next(err));
}

function getPerson(req, res, next) {
  const id = parseInt(req.params.id)
  req.app.locals.db.one(`
    SELECT DISTINCT ON (p.id)
           p.*, preferred_name(p),
           d.status AS daypass, daypass_days(d),
           b.timestamp AS badge_print_time
      FROM people p
 LEFT JOIN daypasses d ON (p.id = d.person_id)
 LEFT JOIN badge_and_daypass_prints b ON (p.id = b.person)
     WHERE p.id = $1
  ORDER BY p.id, b.timestamp`, id)
    .then(data => res.json(data))
    .catch(next)
}

function getAllPrevNames(req, res, next) {
  const { user } = req.session
  if (!user || !user.member_admin && !user.member_list) return next(new AuthError())
  const csv = req.params.fmt === 'csv'
  req.app.locals.db.any(`
    SELECT DISTINCT ON (h.id,h.legal_name)
           h.id,
           p.member_number,
           h.legal_name AS prev_name,
           to_char(h.timestamp, 'YYYY-MM-DD') AS date_from,
           to_char(l.timestamp, 'YYYY-MM-DD') AS date_to,
           p.legal_name AS curr_name,
           p.email AS curr_email
      FROM past_names h
           LEFT JOIN log l ON (h.id=l.subject)
           LEFT JOIN people p ON (l.subject=p.id)
     WHERE l.timestamp > h.timestamp AND
           l.parameters->>'legal_name' IS NOT NULL AND
           name_match(l.parameters->>'legal_name', h.legal_name) = false
  ORDER BY h.id,h.legal_name,l.timestamp`)
    .then(data => {
      if (csv) res.csv(data, true)
      else res.json(data)
    })
    .catch(next)
}

function getPrevNames(req, res, next) {
  const id = parseInt(req.params.id)
  req.app.locals.db.any(`
    SELECT DISTINCT ON (h.legal_name)
           h.legal_name AS prev_legal_name,
           h.timestamp AS time_from,
           l.timestamp AS time_to
      FROM past_names h LEFT JOIN log l ON (h.id=l.subject)
     WHERE h.id = $1 AND
           l.timestamp > h.timestamp AND
           l.parameters->>'legal_name' IS NOT NULL AND
           name_match(l.parameters->>'legal_name', h.legal_name) = false
  ORDER BY h.legal_name,l.timestamp`, id)
    .then(data => res.json(data))
    .catch(next)
}

function addPerson(req, db, person) {
  const passDays = person.passDays
  const status = person.data.membership
  if (passDays.length) {
    person.data.membership = 'NonMember'
    person.data.member_number = null
  }
  const log = new LogEntry(req, 'Add new person');
  let res;
  return db.tx(tx => tx.sequence((i, data) => { switch (i) {

    case 0:
      return tx.one(`INSERT INTO People ${person.sqlValues} RETURNING id, member_number`, person.data);

    case 1:
      person.data.id = data.id
      person.data.member_number = data.member_number
      res = data;
      log.subject = data.id
      return tx.none(`INSERT INTO Log ${log.sqlValues}`, log)

    case 2:
      if (passDays.length) {
        person.data.membership = status
        const trueDays = passDays.map(d => 'true').join(',')
        return tx.none(`
          INSERT INTO daypasses (person_id,status,${passDays.join(',')})
               VALUES ($(id),$(membership),${trueDays})`, person.data
        )
      }

  }}))
    .then(() => res);
}

function authAddPerson(req, res, next) {
  if (!req.session.user.member_admin || typeof req.body.member_number !== 'undefined' && !req.session.user.admin_admin) {
    return res.status(401).json({ status: 'unauthorized' });
  }
  let person;
  try {
    person = new Person(req.body);
  } catch (err) {
    return next(err);
  }
  addPerson(req, req.app.locals.db, person)
    .then(({ id, member_number }) => res.status(200).json({ status: 'success', id, member_number }))
    .catch(next);
}

function updatePerson(req, res, next) {
  const data = Object.assign({}, req.body);
  const isMemberAdmin = req.session.user.member_admin;
  const fieldSrc = isMemberAdmin ? Person.fields : Person.userModFields;
  const fields = fieldSrc.filter(fn => data.hasOwnProperty(fn));
  if (fields.length == 0) return res.status(400).json({ status: 'error', message: 'No valid parameters' });
  let ppCond = '';
  if (fields.indexOf('paper_pubs') >= 0) try {
    data.paper_pubs = Person.cleanPaperPubs(data.paper_pubs);
    if (config.paid_paper_pubs && !isMemberAdmin) {
      if (data.paper_pubs) ppCond = 'AND paper_pubs IS NOT NULL';
      else fields.splice(fields.indexOf('paper_pubs'), 1);
    }
  } catch (e) {
    return res.status(400).json({ status: 'error', message: 'paper_pubs: ' + e.message });
  }
  const sqlFields = fields.map(fn => `${fn}=$(${fn})`).join(', ');
  const log = new LogEntry(req, 'Update fields: ' + fields.join(', '));
  data.id = log.subject = parseInt(req.params.id);
  const db = req.app.locals.db;
  let email = data.email;
  db.tx(tx => tx.batch([
    tx.one(`
           WITH prev AS (SELECT email FROM People WHERE id=$(id))
         UPDATE People p
            SET ${sqlFields}
          WHERE id=$(id) ${ppCond}
      RETURNING email AS next_email, (SELECT email AS prev_email FROM prev),
                hugo_nominator, hugo_voter, preferred_name(p) as name`,
      data),
    data.email ? tx.oneOrNone(`SELECT key FROM Keys WHERE email=$(email)`, data) : {},
    tx.none(`INSERT INTO Log ${log.sqlValues}`, log)
  ]))
    .then(([{ hugo_nominator, hugo_voter, next_email, prev_email, name }, key]) => {
      email = next_email;
      if (next_email === prev_email) return {}
      updateMailRecipient(db, prev_email);
      return !hugo_nominator && !hugo_voter ? {}
        : key ? { key: key.key, name }
        : setKeyChecked(req, db, data.email).then(({ key }) => ({ key, name }));
    })
    .then(({ key, name }) => !!(key && mailTask('hugo-update-email', {
      email,
      key,
      memberId: data.id,
      name
    })))
    .then(key_sent => {
      res.json({ status: 'success', updated: fields, key_sent });
      updateMailRecipient(db, email);
    })
    .catch(err => (ppCond && !err[0].success && err[0].result.message == 'No data returned from the query.')
      ? res.status(402).json({ status: 'error', message: 'Paper publications have not been enabled for this person' })
      : next(err));
}
