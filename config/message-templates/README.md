# Message Templates

In addition to the Web UI, Kansa sends confirmation emails for various actions. Each email requires a corresponding template, i.e. a `.mustache` file in this directory. Not all messages may be appropriate for you, in which case removing them completely may be an appropriate method of guaranteeing that they'll never be sent.

## Template File Format

Each template file should start with a key-value metadata section defining the `from`, `fromname` and `subject` values, followed by the message body. The subject and the body of the message are rendered using [mustache](https://mustache.github.io/mustache.5.html), with values from the data object passed to the messsage handler Kyyhky by either the Kansa or Hugo server.

Once rendered, each message will be wrapped to a maximum width of 78 characters.

## Default Data Fields

The `email` data field will be used as the message recipient address. If `name` is included, that will be used as the recipient name. Values for the `barcode_uri` and `login-uri` data fields will be generated by Kyyhky, provided that the `key` value is set. The calling server may include any additional fields; these need not have string values.

## Custom Message Configuration

In order to format non-string values for messages or otherwise apply changes to the data, a message template may also have a corrsponding `.js` file, which should export a function that may freely modify the message data before processing it further. The exported function will be called with two arguments; the message `data` object and a `wrap(prefix, string)` utility function. The function should modify the input `data` as appropriate. If the function returns a non-empty string, that will be used as the name of the template.

For examples of what's possible, the default `hugo-update-nominations` message includes an indented list that is wrapped with a prefix, and the `kansa-new-payment` message may be rendered with the `kansa-new-siteselection-token` template in certain conditions.
