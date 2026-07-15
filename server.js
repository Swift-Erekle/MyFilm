const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8080;

// Convert cloudflare.js to CommonJS at runtime
const workerPath = path.join(__dirname, 'cloudflare.js');
let workerCode = fs.readFileSync(workerPath, 'utf8');
workerCode = workerCode.replace('export default {', 'module.exports = {');
const tempWorkerPath = path.join(__dirname, 'temp_worker_node.js');
fs.writeFileSync(tempWorkerPath, workerCode);

const worker = require(tempWorkerPath);

// Serve website static files
app.use(express.static(path.join(__dirname, 'website')));

// Handle all proxy endpoints through the worker or fallback to SPA
app.use(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  
  const workerEndpoints = [
    '/imovs',
    '/imovs-series',
    '/animeb',
    '/animetv',
    '/animetv_page',
    '/play',
    '/hls',
    '/hlsseg',
    '/hlskey'
  ];

  if (workerEndpoints.includes(pathname)) {
    try {
      const fullUrl = `http://localhost:${PORT}${req.url}`;
      
      const headers = new Headers();
      Object.entries(req.headers).forEach(([k, v]) => {
         if (v !== undefined) {
           if (Array.isArray(v)) {
             v.forEach(val => headers.append(k, val));
           } else {
             headers.set(k, v);
           }
         }
      });
      
      const init = {
        method: req.method,
        headers: headers,
      };
      
      const requestObj = new Request(fullUrl, init);
      const responseObj = await worker.fetch(requestObj);
      
      res.status(responseObj.status);
      responseObj.headers.forEach((v, k) => {
         res.setHeader(k, v);
      });
      
      if (responseObj.body) {
         const reader = responseObj.body.getReader();
         while (true) {
           const { done, value } = await reader.read();
           if (done) break;
           res.write(value);
         }
      }
      res.end();
    } catch (e) {
      console.error("Worker proxy error:", e);
      if (!res.headersSent) {
        res.status(500).send("Proxy Worker Error");
      }
    }
  } else {
    // Return index.html for SPA routes
    res.sendFile(path.join(__dirname, 'website', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`MyFilm Server is running on port ${PORT}`);
});
