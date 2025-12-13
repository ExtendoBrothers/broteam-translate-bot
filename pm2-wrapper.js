#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Now start the actual bot
require('./dist/src/index.js');