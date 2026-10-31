Fixtures captured from the live site and **sanitized** (player logins replaced with `playerN`, chat texts replaced
with made-up lines). `fair-map.json` is the walk grid + buildings + obstacles of the fair city (geometry only, no art).
Raw site art (SVG) is never committed — at runtime the extension takes it from the page itself.
`fair-jail.json` is the same fair with the channel's jail open (site 31.10, `citymap.js` `make(…, { jail })`: LOW.jail, the
moved decor, the jail building, the obstacles and the walk-grid difference as `[cell, count, value]` runs over
`fair-map.json`'s grid) — numbers only.
