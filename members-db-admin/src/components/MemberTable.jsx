/** Table of members
 *
 * Based on: https://github.com/bvaughn/react-virtualized/blob/7.7.1/source/FlexTable/FlexTable.example.js
 */

import { List } from 'immutable'
import React from 'react'
import shallowCompare from 'react-addons-shallow-compare'
import { AutoSizer, FlexTable, FlexColumn, SortDirection } from 'react-virtualized'

import styles from '../styles/MemberTable.css'

import MemberDialog from './MemberDialog';

export default class MemberTable extends React.Component {
  static propTypes = {
    api: React.PropTypes.object.isRequired,
    list: React.PropTypes.instanceOf(List).isRequired
  }

  constructor(props, context) {
    super(props, context)

    this.state = {
      selectedMember: null,
      headerHeight: 30,
      overscanRowCount: 10,
      rowHeight: 30,
      scrollToIndex: undefined,
      sortBy: 'id',
      sortDirection: SortDirection.ASC
    }

    this._noRowsRenderer = this._noRowsRenderer.bind(this)
  }

  render() {
    const {
      selectedMember,
      headerHeight,
      overscanRowCount,
      rowHeight,
      scrollToIndex,
      sortBy,
      sortDirection
    } = this.state

    const list = this.props.list
      .filter(item => item)
      .sortBy(this._sortFn)
      .update(list => sortDirection === SortDirection.DESC ? list.reverse() : list)

    return (
      <AutoSizer>
        {({ height, width }) => ([
          <FlexTable
            key='table'
            headerClassName={styles.headerColumn}
            headerHeight={headerHeight}
            height={height}
            noRowsRenderer={this._noRowsRenderer}
            overscanRowCount={overscanRowCount}
            rowHeight={rowHeight}
            rowGetter={({ index }) => list.get(index)}
            rowCount={list.size}
            scrollToIndex={scrollToIndex}
            sort={({ sortBy, sortDirection }) => this.setState({ sortBy, sortDirection })}
            sortBy={sortBy}
            sortDirection={sortDirection}
            width={width}
            onRowClick={({ index }) => this.setState({ selectedMember: list.get(index).get('id') })}
          >
            <FlexColumn dataKey='member_number' label='#' width={30} />
            <FlexColumn dataKey='membership' label='Type' width={105} />
            <FlexColumn dataKey='legal_name' label='Name' width={120} flexGrow={1} />
            <FlexColumn dataKey='email' label='Email' width={210} />
            <FlexColumn dataKey='public_name' label='Public' width={120} flexGrow={1}
              cellDataGetter = { ({ rowData }) => this._publicName(rowData) }
            />
            <FlexColumn dataKey='loc' label='Location' width={120} flexGrow={1}
              cellDataGetter = { ({ rowData }) => this._fullLocation(rowData) }
            />
          </FlexTable>,
          selectedMember !== null && list.size && <MemberDialog
            key='dialog'
            formId='member-form'
            cancel={() => this.setState({ selectedMember: null })}
            ok={({ id, form }) => {
              const prev = this.props.list.get(id);
              const update = {};
              const inputs = form.querySelectorAll('input');
              for (let i = 0; i < inputs.length; ++i) {
                const { name, value } = inputs[i];
                const v0 = prev.get(name, '');
                if (value != v0) update[name] = value;
              }
              this.props.api.POST(`people/${id}`, update)
                .then(() => this.setState({ selectedMember: null }))
                .catch(e => console.error(e));
            }}
            member={this.props.list.get(selectedMember)}
          />
        ])}
      </AutoSizer>
    )
  }

  shouldComponentUpdate(nextProps, nextState) {
    return shallowCompare(this, nextProps, nextState)
  }

  get _sortFn() {
    const { sortBy } = this.state;
    switch (sortBy) {
      case 'public_name':  return this._publicSortName;
      case 'loc':          return this._fullLocation;
      default:             return item => item.get(sortBy, '');
    }
  }

  _publicName(person) {
    return ['public_first_name', 'public_last_name'].map(k => person.get(k)).join(' ').trim()
  }

  _publicSortName(person) {
    return ['public_last_name', 'public_first_name'].map(k => person.get(k)).filter(v => !!v).join(';')
  }

  _fullLocation(person) {
    return ['country', 'state', 'city'].map(k => person.get(k)).filter(v => !!v).join(', ')
  }

  _noRowsRenderer() {
    return (
      <div className={styles.noRows}>
        No rows
      </div>
    )
  }
}
