import test from 'node:test';
import assert from 'node:assert/strict';
import { closeExistingSession } from '../provider-hangup.mjs';
test('sideband failure never calls SIP hangup',async()=>{let disconnected=false;assert.equal(await closeExistingSession({sessionId:'live_test',observe:async()=>{throw Error('attach');},disconnect:()=>{disconnected=true;},hangup:assert.fail}),'unconfirmed');assert.equal(disconnected,true)});
test('sideband close request is not settlement',async()=>assert.equal(await closeExistingSession({sessionId:'live_test',observe:async()=>({requestClose(){}}),disconnect:assert.fail}),'sideband_close_requested'));
