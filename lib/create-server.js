module.exports = createServer

var express = require('express')
var fs = require('fs')
var https = require('https')
var http = require('http')
var SolidWs = require('solid-ws')
var debug = require('./debug')
var createApp = require('./create-app')
const globalTunnel = require('global-tunnel-ng')

function createServer (argv, app) {
  argv = argv || {}
  app = app || express()
  var ldpApp = createApp(argv)
  var ldp = ldpApp.locals.ldp || {}
  var mount = argv.mount || '/'
  // Removing ending '/'
  if (mount.length > 1 &&
    mount[mount.length - 1] === '/') {
    mount = mount.slice(0, -1)
  }
  app.use(mount, ldpApp)
  debug.settings('Base URL (--mount): ' + mount)

  if (argv.idp) {
    console.warn('The idp configuration option has been renamed to multiuser.')
    argv.multiuser = argv.idp
    delete argv.idp
  }

  if (argv.httpProxy) {
    globalTunnel.initialize(argv.httpProxy)
  }

  var server
  var needsTLS = argv.sslKey || argv.sslCert ||
                 (ldp.webid || ldp.multiuser) && !argv.certificateHeader
  if (!needsTLS) {
    server = http.createServer(app)
  } else {
    debug.settings('SSL Private Key path: ' + argv.sslKey)
    debug.settings('SSL Certificate path: ' + argv.sslCert)

    if (!argv.sslCert && !argv.sslKey) {
      throw new Error('Missing SSL cert and SSL key to enable WebIDs')
    }

    if (!argv.sslKey && argv.sslCert) {
      throw new Error('Missing path for SSL key')
    }

    if (!argv.sslCert && argv.sslKey) {
      throw new Error('Missing path for SSL cert')
    }

    var key
    try {
      key = fs.readFileSync(argv.sslKey)
    } catch (e) {
      throw new Error('Can\'t find SSL key in ' + argv.sslKey)
    }

    var cert
    try {
      cert = fs.readFileSync(argv.sslCert)
    } catch (e) {
      throw new Error('Can\'t find SSL cert in ' + argv.sslCert)
    }

    var credentials = Object.assign({
      key: key,
      cert: cert
    }, argv)

    if (ldp.webid && ldp.auth === 'tls') {
      credentials.requestCert = true
    }

    server = https.createServer(credentials, app)
  }

  // Look for port or list of ports to redirect to argv.port
  if ('redirectHTTPFrom' in argv) {
    const redirectHTTPFroms = argv.redirectHTTPFrom.constructor === Array
          ? argv.redirectHTTPFrom
          : [argv.redirectHTTPFrom]
    const portStr = argv.port === 443 ? '' : ':' + argv.port
    redirectHTTPFroms.forEach(redirectHTTPFrom => {
      debug.settings('will redirect from port ' + redirectHTTPFrom + ' to port ' + argv.port)
      let redirectingServer = express()
      redirectingServer.get('*', function (req, res) {
        let host = req.headers.host.split(':') // ignore port
        debug.server(host, '=> https://' + host + portStr + req.url)
        res.redirect('https://' + host + portStr + req.url)
      })
      redirectingServer.listen(redirectHTTPFrom)
    })
  }

  // Setup Express app
  if (ldp.live) {
    var solidWs = SolidWs(server, ldpApp)
    ldpApp.locals.ldp.live = solidWs.publish.bind(solidWs)
  }

  return server
}
