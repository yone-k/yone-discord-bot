// Only the external Discord Gateway/REST boundary is replaced. The real Bot
// startup, HTTP client and health handler run unchanged.
const { Client, Events } = require('discord.js');
const { REST } = require('@discordjs/rest');

Client.prototype.login = async function (token) {
  this.readyTimestamp = Date.now();
  queueMicrotask(() => this.emit(Events.ClientReady, this));
  return token;
};
Client.prototype.isReady = function () { return this.readyTimestamp !== null; };
REST.prototype.request = async function () {
  throw new Error('Unexpected TypeScript Discord REST request in the image smoke test');
};
