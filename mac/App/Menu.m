// The app's own process: its item in the menu bar, and what starts the hub and a window. It holds no device, and no
// Node runs while it waits. The hub and each window are the command line's `appdyno`, in processes of their own, so
// the app and the npm package run one code, and a crash there costs this nothing.
//   Appdyno           the hub, and the item in the menu bar
//   Appdyno --behind  the same, kept off every screen, for a test on a Mac a person is using
//   Appdyno --menu    prints what the menu lists, and ends
//   Appdyno --said <update --check's words>   prints what a person is told of them, and ends, for a test
#import "../Viewer/Defaults.h"
#import "../Viewer/Updates.h"
#import "../Viewer/Words.h"
#import <Cocoa/Cocoa.h>
#import <libproc.h>

/// The release a person last said no to, which is not offered again by itself, and when a release was last looked for.
static NSString *const SaidNo = @"declinedUpdate";
static NSString *const LookedAt = @"lastUpdateCheck";
/// A look a day, by the clock on the wall: a timer of a day counts no sleep, and a laptop sleeps most of its days.
static const NSTimeInterval kDay = 24 * 60 * 60, kHour = 60 * 60;

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
  if (!task) return done(127, MVWord(@"appdyno could not be started"));
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
  /// The release offered now, which is all an Install from the window may install, and what was said of it.
  NSString *_update;
  NSDictionary *_offered;
  NSTimer *_hourly;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [MVDefaults() registerDefaults:@{MVUpdatesByItself: @YES}];
  NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
  _behind = [args containsObject:@"--behind"];
  if ([args containsObject:@"--menu"]) return [self printMenu];
  NSUInteger said = [args indexOfObject:@"--said"];
  if (said != NSNotFound && said + 1 < args.count) {
    NSDictionary *plain = MVUpdateWords(args[said + 1]);
    printf("%s\n%s\n%s\n", [plain[@"title"] UTF8String], [plain[@"text"] UTF8String], [plain[@"offer"] ?: @"" UTF8String]);
    return [NSApp terminate:nil];
  }
  // an app that moved: what points at it follows, and with nothing stale this writes nothing
  Ask(@[@"install", @"--moved"], ^(__unused int code, __unused NSString *words){});
  [self showItem];
  [self openHub];
  // a test's app, off every screen, asks no network
  if (_behind) return;
  [self listenToWindow];
  [self lookForUpdate];
  _hourly = [NSTimer scheduledTimerWithTimeInterval:kHour
                                            repeats:YES
                                              block:^(__unused NSTimer *timer) {
                                                [self lookIfDue];
                                              }];
  _hourly.tolerance = 10 * 60;
  [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidWakeNotification
                                                              object:nil
                                                               queue:NSOperationQueue.mainQueue
                                                          usingBlock:^(__unused NSNotification *note) {
                                                            [self lookIfDue];
                                                          }];
}

/// The hub's window asks by name, as it is another process: a look now, and a person's yes or no to what was offered.
- (void)listenToWindow {
  NSDistributedNotificationCenter *center = NSDistributedNotificationCenter.defaultCenter;
  [center addObserverForName:MVUpdateCheck
                      object:nil
                       queue:NSOperationQueue.mainQueue
                  usingBlock:^(__unused NSNotification *note) {
                    [self lookNow:YES];
                  }];
  [center addObserverForName:MVUpdateInstall
                      object:nil
                       queue:NSOperationQueue.mainQueue
                  usingBlock:^(NSNotification *note) {
                    // only what was offered: a word from elsewhere installs nothing else
                    if (self->_update && [note.userInfo[@"version"] isEqual:self->_update]) [self install];
                  }];
  // a window that opened after a look heard none of it: what is offered and not turned down is said again
  [center addObserverForName:MVUpdateWindowUp
                      object:nil
                       queue:NSOperationQueue.mainQueue
                  usingBlock:^(__unused NSNotification *note) {
                    if (self->_offered && ![self->_update isEqual:[MVDefaults() stringForKey:SaidNo]]) [self tell:self->_offered inWindow:YES];
                  }];
  [center addObserverForName:MVUpdateLater
                      object:nil
                       queue:NSOperationQueue.mainQueue
                  usingBlock:^(NSNotification *note) {
                    if ([note.userInfo[@"version"] isKindOfClass:NSString.class]) [MVDefaults() setObject:note.userInfo[@"version"] forKey:SaidNo];
                  }];
}

- (void)lookIfDue {
  NSDate *last = [MVDefaults() objectForKey:LookedAt];
  if (![last isKindOfClass:NSDate.class] || -last.timeIntervalSinceNow >= kDay) [self lookForUpdate];
}

/// On opening, then once a day while it runs: a newer release is offered once, and installed only on the person's word.
/// No answer, as offline, or a build with no update key, says nothing.
- (void)lookForUpdate {
  if (![MVDefaults() boolForKey:MVUpdatesByItself]) return;
  [MVDefaults() setObject:NSDate.date forKey:LookedAt];
  Ask(@[@"update", @"--check"], ^(__unused int code, NSString *said) {
    NSDictionary *plain = MVUpdateWords(said);
    self->_update = plain[@"offer"];
    self->_offered = self->_update ? plain : nil;
    NSString *news = self->_update ?: plain[@"latest"];
    if (!news.length || [news isEqual:[MVDefaults() stringForKey:SaidNo]]) return;
    [self tell:plain inWindow:YES];
    // what cannot be installed here is said once a release, as an offer turned down is
    if (!self->_update) [MVDefaults() setObject:news forKey:SaidNo];
  });
}

/// A look a person asked for: always answered, up to date or not, where they asked.
- (void)lookNow:(BOOL)fromWindow {
  Ask(@[@"update", @"--check"], ^(__unused int code, NSString *said) {
    NSDictionary *plain = MVUpdateWords(said);
    self->_update = plain[@"offer"];
    self->_offered = self->_update ? plain : nil;
    [self tell:plain inWindow:fromWindow];
  });
}

- (void)checkForUpdates {
  [self lookNow:NO];
}

- (void)lookByItself:(NSMenuItem *)item {
  BOOL on = item.state != NSControlStateValueOn;
  [MVDefaults() setBool:on forKey:MVUpdatesByItself];
  if (on) [self lookForUpdate];
}

/// The hub's window is where a person is: it shows what was found. With none open, an alert of this app's says it.
- (void)tell:(NSDictionary *)plain inWindow:(BOOL)window {
  if (window && _hub.running) {
    [NSDistributedNotificationCenter.defaultCenter postNotificationName:MVUpdateAnswer object:nil userInfo:plain deliverImmediately:YES];
    return;
  }
  if (!plain[@"offer"]) return [self tell:plain[@"title"] saying:plain[@"text"]];
  if ([self confirm:plain[@"title"] saying:plain[@"text"] with:MVWord(@"Install and Restart")]) return [self install];
  [MVDefaults() setObject:plain[@"offer"] forKey:SaidNo];
}

- (void)install {
  Ask(@[@"update"], ^(int done, NSString *result) {
    if (done != 0) return [self tell:MVWord(@"The update did not finish") saying:result];
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

/// The hub's window is a process this one starts, not one a person opened: from macOS 14 it comes to the front only
/// where the app in front lets it, and as this app was just opened, it is that app.
- (void)openHub {
  if (_hub.running) {
    pid_t children[8];
    if (proc_listchildpids(_hub.processIdentifier, children, sizeof children) > 0) {
      NSRunningApplication *window = [NSRunningApplication runningApplicationWithProcessIdentifier:children[0]];
      if (!window) return;
      if (@available(macOS 14, *)) [NSApp yieldActivationToApplication:window];
      [window activateWithOptions:NSApplicationActivateAllWindows];
    }
    return;
  }
  if (@available(macOS 14, *))
    if (!_behind) [NSApp yieldActivationToApplicationWithBundleIdentifier:@"dev.appdyno.window"];
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
  NSMenuItem *item = [menu addItemWithTitle:MVWord(title) action:action keyEquivalent:@""];
  item.target = self;
}

- (void)fill:(NSMenu *)menu {
  [menu removeAllItems];
  [self add:@"Open Hub" to:menu action:@selector(openHub)];
  [menu addItem:NSMenuItem.separatorItem];
  if (!_devices.count) [menu addItemWithTitle:MVWord(_devices ? @"No devices" : @"Looking for devices…") action:nil keyEquivalent:@""];
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
  [self add:_update ? @"Update Available…" : @"Check for Updates…" to:menu action:@selector(checkForUpdates)];
  NSMenuItem *byItself = [menu addItemWithTitle:MVWord(@"Check for Updates Automatically") action:@selector(lookByItself:) keyEquivalent:@""];
  byItself.target = self;
  byItself.state = [MVDefaults() boolForKey:MVUpdatesByItself] ? NSControlStateValueOn : NSControlStateValueOff;
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

/// The person's word, or that they gave none. An app with no window of its own comes to the front for it.
- (BOOL)confirm:(NSString *)message saying:(NSString *)text with:(NSString *)button {
  [NSApp activateIgnoringOtherApps:YES];
  NSAlert *alert = [NSAlert new];
  alert.messageText = message;
  alert.informativeText = text;
  [alert addButtonWithTitle:button];
  [alert addButtonWithTitle:MVWord(@"Later")];
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
  if ([self confirm:MVWord(@"Put appdyno on the PATH?")
             saying:MVWord(@"Every terminal will find appdyno. This adds a link at /usr/local/bin/appdyno, and macOS may ask for your password.")
               with:MVWord(@"Put on PATH")])
    [self doing:@[@"path"] title:MVWord(@"appdyno on the PATH")];
}

- (void)addToClients {
  Ask(@[@"install", @"--dry-run"], ^(__unused int code, NSString *said) {
    if ([self confirm:MVWord(@"Add Appdyno to these MCP clients?") saying:said with:MVWord(@"Add")])
      [self doing:@[@"install", @"--yes"] title:MVWord(@"MCP clients")];
  });
}

- (void)getAdb {
  if ([self confirm:MVWord(@"Download adb from Google?")
             saying:MVWord(@"Android phones need adb, and Google's terms keep it out of this app. This downloads Google's platform-tools, 16 MB, and checks it. By downloading you accept Google's terms: https://developer.android.com/studio/terms")
               with:MVWord(@"Accept and Download")])
    [self doing:@[@"tools", @"install", @"adb", @"--accept-license"] title:@"adb"];
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
