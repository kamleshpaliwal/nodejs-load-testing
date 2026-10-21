import test from 'node:test';
import assert from 'node:assert/strict';
import {createRandom,makeItem} from '../src/data.js';
import {percentile,evaluateSlo} from '../src/metrics.js';
import {validateConfig,redactConfig} from '../src/config.js';
import {versionTransition,detectDuplicateCommits,checkInvariant} from '../src/assertions.js';

test('seeded data repeats for same seed and differs for another',()=>{assert.deepEqual(makeItem(42,1),makeItem(42,1));assert.notDeepEqual(makeItem(42,1),makeItem(43,1));assert.equal(createRandom(7)(),createRandom(7)());});
test('percentile interpolates and handles empty input',()=>{assert.equal(percentile([0,10],.5),5);assert.equal(percentile([], .95),null);});
test('SLO reports missing metrics as not evaluable',()=>{const x=evaluateSlo({completedScenarios:0,scenarioRate:0,scheduledScenarios:0,droppedScenarios:0,latencyMs:null,errorRatePercent:null,timeoutRatePercent:null},{slo:{p95LatencyMs:2,maxErrorRatePercent:1,maxTimeoutRatePercent:1,minScenariosPerSecond:0,maxDroppedArrivalPercent:0,minSamples:1}});assert.equal(x.verdict,'NOT_EVALUABLE');assert.ok(x.checks.some(c=>c.status==='NOT_EVALUABLE'));});
test('safety validates schemes and remote opt-in',()=>{assert.throws(()=>validateConfig({target:'file:///etc/passwd',scenarioRate:1,concurrency:1,durationSeconds:1,requestTimeoutMs:10}));assert.throws(()=>validateConfig({target:'https://example.com',scenarioRate:1,concurrency:1,durationSeconds:1,requestTimeoutMs:10}));});
test('redaction removes credentials and query parameters',()=>{const c=redactConfig({target:'https://user:pass@example.com/path?token=secret',headers:{Authorization:'Bearer abc'}});assert.equal(c.target,'https://example.com/path');assert.equal(c.headers.Authorization,'[REDACTED]');});
test('version and duplicate commit checks use authoritative records',()=>{assert.equal(versionTransition(1,2).valid,true);assert.equal(versionTransition(1,3).valid,false);assert.equal(detectDuplicateCommits([{operationId:'x',outcome:'committed'},{operationId:'x',outcome:'committed'}])[0].count,2);});
test('invariant violation is explicitly represented as a failed assertion',()=>{const a=checkInvariant({id:'expected-state',name:'state match',condition:false,expected:'committed',actual:'missing',context:{runId:'r'}});assert.equal(a.passed,false);assert.equal(a.category,'functional');});
test('SLO threshold breach is a failure',()=>{const x=evaluateSlo({completedScenarios:2,scenarioRate:0.1,scheduledScenarios:2,droppedScenarios:0,latencyMs:{p95:20},errorRatePercent:50,timeoutRatePercent:0},{slo:{p95LatencyMs:10,maxErrorRatePercent:1,maxTimeoutRatePercent:1,minScenariosPerSecond:0,maxDroppedArrivalPercent:0,minSamples:1}});assert.equal(x.verdict,'FAIL');assert.equal(x.checks.find(c=>c.id==='error-rate').status,'FAIL');});
