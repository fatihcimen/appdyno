// What Help says of each word in the hub and of what goes wrong: a list to read, kept apart from how it is laid out.
#import "HubHelpParts.h"
#import "Words.h"

NSArray<NSArray<NSString *> *> *MVHelpMeanings(void) {
  return @[
    @[MVWord(@"Performance"), MVWord(@"How the screen moves, what the app in front uses, and what was measured on this device before.")],
    @[MVWord(@"Flows"), MVWord(@"Records what you do on the device as steps that an AI client or a test can run again.")],
    @[MVWord(@"Apps"), MVWord(@"Lists, launches, quits and removes the apps on the device.")],
    @[MVWord(@"Activity"), MVWord(@"What an AI client did on this device, as runs of work that open to each step.")],
    @[MVWord(@"Frame rate"), MVWord(@"New pictures the device sends each second. A still screen sends none, and that is no fault.")],
    @[MVWord(@"CPU"), MVWord(@"What the app in front uses of the device's processor, read with a stream running, which costs the device too.")],
    @[MVWord(@"Memory"), MVWord(@"What the app in front holds on the device.")],
    @[MVWord(@"Cold launch"), MVWord(@"The time from a closed app to its first screen: the middle of several runs.")],
    @[MVWord(@"Jank"), MVWord(@"The share of frames that came late while scrolling.")],
    @[MVWord(@"Frozen"), MVWord(@"Frames that held the screen for 700 ms or longer.")],
    @[MVWord(@"Regression"), MVWord(@"A change appdyno is sure of: enough samples, and more than the runs before it moved.")],
    @[MVWord(@"could not judge"), MVWord(@"There was not enough to call it: too few samples, a measure under load, or two builds of different kinds. It is neither a pass nor a regression, so measure again.")],
    @[MVWord(@"noisy"), MVWord(@"The Mac or the device was too busy or too hot while it measured. The run says nothing of your app, and it does not become a baseline.")],
    @[MVWord(@"mirrored"), MVWord(@"A stream, a recording or a timeline ran during the measure. An encoder at work on the device can move the number, so appdyno does not judge that run.")],
    @[MVWord(@"modelled"), MVWord(@"An estimate from CPU time and bytes, for a device with no energy reading of its own. It tells runs on one device apart, and is no real figure.")],
  ];
}

NSArray<NSArray<NSString *> *> *MVHelpFailures(void) {
  return @[
    @[MVWord(@"The client lists no tools, and shows no error"), MVWord(@"Restart it: most read their list once. Then look in its log, and run Doctor.")],
    @[MVWord(@"no connected device this server may drive"), MVWord(@"adb or Xcode does not see one, or --allow-devices shuts it out.")],
    @[MVWord(@"more than one device"), MVWord(@"Ask your client to use the device you mean.")],
    @[MVWord(@"is held by pid"), MVWord(@"Another program drives that device. Stop it, or use --share.")],
    @[MVWord(@"A first call on iOS fails or times out"), MVWord(@"The runner is still building and the client gave up. Run appdyno ios build, then try again.")],
    @[MVWord(@"An app cannot find npx or adb"), MVWord(@"An app opened from the Dock has a short PATH. AI Clients tests this, and says what to change.")],
    @[MVWord(@"401 on the HTTP server"), MVWord(@"No token, or the wrong one.")],
    @[MVWord(@"409 on the HTTP server"), MVWord(@"Another client holds the server. Wait 10 minutes from its last call, or stop the server.")],
  ];
}
