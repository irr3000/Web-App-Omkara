const fs = require('fs');
const http = require('http');
const path = require('path');

const { APP_PORT, APP_IP, APP_PATH } = process.env;

const indexPath = path.join(path.dirname(APP_PATH), 'index.html')

const server = http.createServer((req, res) => {
  fs.readFile(indexPath, (err, data) => {
    if (err) {
      res.writeHead(400, {'Content-Type': 'text/plain'});
      res.write('index.html not found');
    } else {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write(data);
    }
    res.end();
  })
}).listen(APP_PORT, APP_IP, () => {
  console.log(`Server running at http://${APP_IP}:${APP_PORT}/`);
});

process.on('SIGTERM', () => {
  console.info('SIGTERM signal received.');
  console.log('Closing http server.');
  server.close(() => {
    console.log('Http server closed.');
    process.exit(0);
  });
});
