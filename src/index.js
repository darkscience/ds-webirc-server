import express from 'express';
import irc from 'irc';
import Immutable from 'immutable';

const IRC_HOST = process.env['IRC_HOST'];
const IRC_PORT = process.env['IRC_PORT'];
const IRC_CHANNELS = (process.env['IRC_CHANNELS'] || '').split(',');
const IRC_SSL = process.env['IRC_SSL'] == '1';
const IRC_INSECURE = process.env['IRC_INSECURE'] == '1';
const PORT = process.env['PORT'];

const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

let clients = Immutable.List();

class IrcUser {
  constructor(ws) {
    this.ws = ws;
    this.bindWsListeners();
  }

  connect(nick) {
    if (this.irc) {
      this.quit('Reconnecting.').then(() => this.connect(nick));
    }
    else {
      this.nick = nick;
      this.irc = new irc.Client(IRC_HOST, nick, {
        channels: IRC_CHANNELS,
        port: IRC_PORT,
        secure: IRC_SSL,
        selfSigned: IRC_INSECURE,
        certExpired: IRC_INSECURE,
        debug: true
      });

      this.bindIrcListeners();
    }
  }

  bindIrcListeners() {
    this.irc.addListener('error', err => {
      this.ws.emit('irc_error', err);
      console.error(`error [nick ${this.nick}]: ${err}`);
    });

    // All of these events are simply proxied by us from the IRC server to the
    // web socket. The first string is the name of the event, the remaining
    // strings in each item are the names of the properties on the object sent
    // over the web socket. They appear in the order they appear as arguments to
    // the callback function invoked by the `irc` library.
    [
      ['registered'],
      ['motd', 'motd'],
      ['join', 'channel', 'nick'],
      ['part', 'channel', 'nick'],
      ['message', 'from', 'to', 'text'],
      ['pm', 'from', 'text'],
      ['nick', 'oldNick', 'newNick', 'channels'],
      ['notice', 'from', 'to', 'text'],
      ['topic', 'channel', 'topic', 'nick'],
      ['names', 'channel', 'users']
    ].forEach(event => {
      this.irc.addListener(event[0], (...args) => {
        //event.slice(1).forEach((arg, i) => data[arg] = argVals[i - 1]);
        this.ws.send(event[0], ...args);
      });
    });

    this.irc.addListener('registered', () => this.nick = this.irc.nick);
  }

  bindWsListeners() {
    const ws = this.ws;
    ws.on('register', nick => this.connect(nick));

    ws.on('nick', nick => this.irc.send('NICK', nick));

    ws.on('join', channel => this.irc.join(channel));
    ws.on('part', (channel, message) => {
      this.irc.part(channel, message || 'Leaving.');
    });
    ws.on('say', (target, message) => this.irc.say(target, message));

    ws.on('disconnect', () => this.quit());
    ws.on('quit', () => this.quit());
  }

  quit(message="Leaving.") {
    return new Promise((resolve, reject) => {
      if (this.irc) {
        this.irc.disconnect(message, () => {
          this.irc = null;
          resolve();
        });
      }
      else {
        resolve();
      }
    });
  }
}

io.on('connection', sock => {
  const user = new IrcUser(sock);
  clients = clients.push(user);
  sock.on('disconnect', () => clients = clients.filter(c => c.ws != sock));
});

server.listen(PORT);
