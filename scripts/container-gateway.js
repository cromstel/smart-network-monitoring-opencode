// Prints the default-gateway IPv4 from /proc/net/route.
// The gateway field is little-endian hex, hence the reversed byte order.
const fs = require('fs')
const line = fs
  .readFileSync('/proc/net/route', 'utf8')
  .split('\n')
  .find((l) => l.split('\t')[1] === '00000000')
if (!line) process.exit(1)
const hex = line.split('\t')[2]
console.log([3, 2, 1, 0].map((i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).join('.'))
