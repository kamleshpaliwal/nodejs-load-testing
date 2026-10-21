import fs from 'node:fs';import path from 'node:path';
const dir=process.argv[2];if(!dir){console.error('Usage: npm run report -- results/<runId>');process.exit(2);}const p=path.resolve(dir);if(!fs.existsSync(path.join(p,'summary.json'))){console.error(`No summary.json in ${p}`);process.exit(1);}console.log(fs.readFileSync(path.join(p,'report.html'),'utf8'));
