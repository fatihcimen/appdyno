// The app's own process: its item in the menu bar, and what starts the hub and a window. It holds no device, and no
// Node runs while it waits. The hub and each window are the command line's `appdyno`, in processes of their own, so
// the app and the npm package run one code, and a crash there costs this nothing.
//   Appdyno           the hub, and the item in the menu bar
//   Appdyno --behind  the same, kept off every screen, for a test on a Mac a person is using
//   Appdyno --menu    prints what the menu lists, and ends
#import <Cocoa/Cocoa.h>
#import <libproc.h>

static NSString *Command(void) {
  return [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"bin/appdyno"];
}

static NSTask *Start(NSArray<NSString *> *words, id output) {
  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:Command()];
  task.arguments = words;
  task.standardInput = NSFileHandle.fileHandleWithNullDevice;
  task.standardOutput = output;
  task.standardError = output;
  return [task launchAndReturnError:NULL] ? task : nil;
}

/// What a command says, whole, on the main queue, once it has ended.
static void Ask(NSArray<NSString *> *words, void (^done)(int code, NSString *said)) {
  NSPipe *pipe = NSPipe.pipe;
  NSTask *task = Start(words, pipe);
  if (!task) return done(127, @"appdyno could not be started");
  [pipe.fileHandleForWriting closeFile];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSData *data = [pipe.fileHandleForReading readDataToEndOfFile];
    [task waitUntilExit];
    NSString *said = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
    int code = task.terminationStatus;
    dispatch_async(dispatch_get_main_queue(), ^{
      done(code, [said stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]);
    });
  });
}

@interface AppMenu : NSObject <NSApplicationDelegate, NSMenuDelegate>
@end

@implementation AppMenu {
  NSStatusItem *_item;
  NSTask *_hub;
  BOOL _behind;
  NSArray<NSDictionary *> *_devices;
  BOOL _noAdb;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
  _behind = [args containsObject:@"--behind"];
  if ([args containsObject:@"--menu"]) return [self printMenu];
  // an app that moved: what points at it follows, and with nothing stale this writes nothing
  Ask(@[@"install", @"--moved"], ^(__unused int code, __unused NSString *said){});
  [self showItem];
  [self openHub];
}

- (void)showItem {
  _item = [NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
  _item.button.image = [NSImage imageNamed:@"menuTemplate"];
  _item.button.image.template = YES;
  _item.button.image.accessibilityDescription = @"Appdyno";
  _item.menu = [NSMenu new];
  _item.menu.delegate = self;
  [self fill:_item.menu];
}

/// Double click while it runs: there is no window of this process to bring forward, only the hub's.
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
  [self openHub];
  return NO;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  if (_hub.running) [_hub terminate];
}

- (void)openHub {
  if (_hub.running) {
    pid_t children[8];
    if (proc_listchildpids(_hub.processIdentifier, children, sizeof children) > 0) {
      [[NSRunningApplication runningApplicationWithProcessIdentifier:children[0]]
          activateWithOptions:NSApplicationActivateAllWindows];
    }
    return;
  }
  _hub = Start(@[@"hub", _behind ? @"--behind" : @"--focus"], NSFileHandle.fileHandleWithNullDevice);
}

- (void)openWindow:(NSMenuItem *)item {
  NSMutableArray *words = [@[@"mirror", @"--device", item.representedObject] mutableCopy];
  if (_behind) [words addObject:@"--behind"];
  Start(words, NSFileHandle.fileHandleWithNullDevice);
}

- (void)read:(void (^)(void))done {
  Ask(@[@"devices", @"--json"], ^(__unused int code, NSString *said) {
    // what a tool said on stderr comes first
    NSString *last = [said componentsSeparatedByString:@"\n"].lastObject;
    NSData *data = [last dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *read = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
    self->_devices = read[@"devices"] ?: @[];
    self->_noAdb = ![read[@"adb"] boolValue];
    done();
  });
}

- (void)menuWillOpen:(NSMenu *)menu {
  [self fill:menu];
  __weak NSMenu *open = menu;
  [self read:^{
    if (open) [self fill:open];
  }];
}

- (void)add:(NSString *)title to:(NSMenu *)menu action:(SEL)action {
  NSMenuItem *item = [menu addItemWithTitle:title action:action keyEquivalent:@""];
  item.target = self;
}

- (void)fill:(NSMenu *)menu {
  [menu removeAllItems];
  [self add:@"Open Hub" to:menu action:@selector(openHub)];
  [menu addItem:NSMenuItem.separatorItem];
  if (!_devices.count) [menu addItemWithTitle:_devices ? @"No devices" : @"Looking for devices…" action:nil keyEquivalent:@""];
  for (NSDictionary *device in _devices) {
    NSString *name = device[@"model"] ?: device[@"serial"];
    NSMenuItem *item = [menu addItemWithTitle:name action:@selector(openWindow:) keyEquivalent:@""];
    item.target = self;
    item.representedObject = device[@"serial"];
  }
  if (_noAdb) [self add:@"Get adb for Android…" to:menu action:@selector(getAdb)];
  [menu addItem:NSMenuItem.separatorItem];
  [self add:@"Put appdyno on the PATH…" to:menu action:@selector(putOnPath)];
  [self add:@"Add to MCP Clients…" to:menu action:@selector(addToClients)];
  [self add:@"Check for Updates…" to:menu action:@selector(checkForUpdates)];
  [menu addItem:NSMenuItem.separatorItem];
  [self add:@"Quit Appdyno" to:menu action:@selector(quit)];
}

- (void)printMenu {
  [self showItem];
  [self read:^{
    [self fill:self->_item.menu];
    printf("in the menu bar: %s\n", self->_item.button.window.visible ? "yes" : "no");
    for (NSMenuItem *item in self->_item.menu.itemArray)
      if (!item.separatorItem) printf("%s\n", item.title.UTF8String);
    [NSApp terminate:nil];
  }];
}

/// The person's word, or that they gave none.
- (BOOL)confirm:(NSString *)message saying:(NSString *)text with:(NSString *)button {
  [NSApp activateIgnoringOtherApps:YES];
  NSAlert *alert = [NSAlert new];
  alert.messageText = message;
  alert.informativeText = text;
  [alert addButtonWithTitle:button];
  [alert addButtonWithTitle:@"Cancel"];
  return [alert runModal] == NSAlertFirstButtonReturn;
}

- (void)tell:(NSString *)message saying:(NSString *)text {
  [NSApp activateIgnoringOtherApps:YES];
  NSAlert *alert = [NSAlert new];
  alert.messageText = message;
  alert.informativeText = text;
  [alert runModal];
}

- (void)doing:(NSArray<NSString *> *)words title:(NSString *)title {
  Ask(words, ^(__unused int code, NSString *said) {
    [self tell:title saying:said];
  });
}

- (void)putOnPath {
  if ([self confirm:@"Put appdyno on the PATH?"
             saying:@"Every terminal will find appdyno. This adds a link at /usr/local/bin/appdyno, and macOS may ask for your password."
               with:@"Put on PATH"])
    [self doing:@[@"path"] title:@"appdyno on the PATH"];
}

- (void)addToClients {
  Ask(@[@"install", @"--dry-run"], ^(__unused int code, NSString *said) {
    if ([self confirm:@"Add Appdyno to these MCP clients?" saying:said with:@"Add"])
      [self doing:@[@"install", @"--yes"] title:@"MCP clients"];
  });
}

- (void)getAdb {
  if ([self confirm:@"Download adb from Google?"
             saying:@"Android phones need adb, and Google's terms keep it out of this app. This downloads Google's platform-tools, 16 MB, and checks it. By downloading you accept Google's terms: https://developer.android.com/studio/terms"
               with:@"Accept and Download"])
    [self doing:@[@"tools", @"install", @"adb", @"--accept-license"] title:@"adb"];
}

- (void)checkForUpdates {
  Ask(@[@"update", @"--check"], ^(__unused int code, NSString *said) {
    if (![said containsString:@"would download"]) return [self tell:@"Updates" saying:said];
    if (![self confirm:@"Install the new version?" saying:said with:@"Install"]) return;
    Ask(@[@"update"], ^(int done, NSString *result) {
      if (done != 0) return [self tell:@"The update did not finish" saying:result];
      NSWorkspaceOpenConfiguration *config = NSWorkspaceOpenConfiguration.configuration;
      config.createsNewApplicationInstance = YES;
      [NSWorkspace.sharedWorkspace openApplicationAtURL:NSBundle.mainBundle.bundleURL
                                          configuration:config
                                      completionHandler:^(__unused NSRunningApplication *app, __unused NSError *error) {
                                        dispatch_async(dispatch_get_main_queue(), ^{
                                          [NSApp terminate:nil];
                                        });
                                      }];
    });
  });
}

- (void)quit {
  [NSApp terminate:nil];
}

@end

int main(void) {
  @autoreleasepool {
    AppMenu *delegate = [AppMenu new];
    NSApplication *application = NSApplication.sharedApplication;
    application.delegate = delegate;
    [application run];
  }
  return 0;
}
