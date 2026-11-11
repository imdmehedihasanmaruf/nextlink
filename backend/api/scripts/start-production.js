'use strict';

// Production entry point. NODE_ENV is pinned to 'production' before config loads,
// so the production gate in config.js can't be bypassed by the environment.
process.env.NODE_ENV = 'production';
require('../src/server');
