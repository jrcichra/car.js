// Modules to control application life and create native browser window
const {
  app,
  BrowserWindow
} = require('electron')
const path = require('path')
const fs = require('fs');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function gpsStuff() {

  console.log("doing GPS stuff");

  //Justin GPS code
  var file = '/dev/ttyS0';

  const SerialPort = require('serialport');
  const parsers = SerialPort.parsers;

  const parser = new parsers.Readline({
    delimiter: '\r\n'
  });

  const port = new SerialPort(file, {
    baudRate: 9600
  });

  port.pipe(parser);


  var GPS = require('gps');
  var gps = new GPS;

  gps.on('RMC', function (data) {

    //make sure the checksum is good
    if (data.valid) {
	  //write to file
      fs.appendFileSync('data.log',JSON.stringify(data));
      //only pass on what mapbox cares about
      let o = {
        lat: data.lat,
        lon: data.lon,
        time: data.time,
        //convert speed to mph from kph
        speed: data.speed / 1.609,
        bearing: data.track
      }

      // when we get gps data, send it to the client to handle
      mainWindow.webContents.send('gps-update', o);
      // console.log(gps.state);
      // console.log(gps.state.lat);
    } else {
      console.log("We got bad data from the GPS (checksum)")
    }
  });

  parser.on('data', function (data) {
    gps.update(data);
  });
}

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      //I know this is bad, but I can't get it to work without this for the clientside, browserify
      //does not play nice with including electron
      //https://github.com/electron/electron/issues/7300
      nodeIntegration: true
    }
  })

  // and load the index.html of the app.
  mainWindow.loadFile('index.html')

  mainWindow.webContents.on('did-finish-load', () => {
    gpsStuff();
  });

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createWindow()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
