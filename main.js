// Modules to control application life and create native browser window
const {
  app,
  BrowserWindow,
  ipcMain
} = require('electron')
const path = require('path')
const fs = require('fs');
var ipc = ipcMain;
const util = require('util');
const {
  spawn
} = require('child_process');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

// Keep a global for the directions we want to keep around - this gets overwritten if we get a new direction request
let directions = [];
let directions_request = 0; //first one should be one
let direction_index = 0; //where we are in the current direction process

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
      fs.appendFileSync('data.log', JSON.stringify(data));
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

async function speakDirection() {

  //uses the direction globals
  //get the direction and increment the index
  let current = directions[direction_index++];
  //pull out what we need to speak it, which is just the 'instruction' line
  let instruction = current.instruction;
  //use that instruction as an argument to espeak with quotes around it
  let espeak = spawn('espeak', ["'" + instruction + "'"]);

  //capture output for espeak (if there are any errors) to the console
  espeak.stdout.on('data', data => {
    console.log(`stdout: ${data}`);
  });
  espeak.stderr.on('data', data => {
    console.log(`stderr:${data}`);
  });
  //handle anything that should be done after espeak is done speaking
  espeak.on('close', code => {
    // console.log(`espeak ended with code ${code}`);
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
  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    console.log("did-finish-load done")

    //maximize - https://github.com/electron/electron/issues/7779
    mainWindow.maximize();

    gpsStuff();

    // let the backend get direction information to act on with system stuff
    ipc.on('osrm', function (event, arg) {
      // see if we got a new set of directions or not
      if (arg.request == directions_request) {
        //It's a continuation (or the first one). Append this onto our object
        directions.append(arg);
      } else {
        //This is a new set of directions, update the number, clean the directions, and append this new one
        directions_request = args.request;
        directions = [];
        directions.append(arg);
        //Since this is the first one in a new set, let's say what the first direction is and prep ourselves
        //to say more when we get close enough to the next point, and the next, etc.

        //This only gets us started, so when we plug in directions, it speaks it
        speakDirection();

        //While that's speaking, we want to be calculating our position and the distance to the next maneuver
        // if we get too far away, we should recalculate a route (which, who knows, might have a )
      }
      // console.log(util.inspect(arg, false, null, true /* enable colors */ ));
    });

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