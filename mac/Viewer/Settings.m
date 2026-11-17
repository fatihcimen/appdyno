// The app's own items in every window's menu, About, Check for Updates and Settings, and Settings' window. Run from the
// app, its own process looks for releases and installs one, and the hub's window shows what it found; a copy run by npm
// is updated by `appdyno update`, which the hub runs for a look.
#import "Settings.h"
#import "Defaults.h"
#import "HubParts.h"
#import "Place.h"
#import "Updates.h"
#import "Words.h"
#import <sys/sysctl.h>

static BOOL gByItselfHere = YES;
/// The project's home, whose pages the Help menu opens.
static NSString *const kHome = @"https://github.com/fatihcimen/appdyno";
static NSMutableArray<NSArray *> *gTold;

BOOL MVInTheApp(void) {
  return NSProcessInfo.processInfo.environment[@"APPDYNO_HELPERS"] != nil;
}

BOOL MVUpdatesByItselfOn(void) {
  if (MVPlaceIsBehind()) return gByItselfHere;
  id kept = [MVAppDefaults() objectForKey:MVUpdatesByItself];
  return kept ? [kept boolValue] : YES;
}

void MVSetUpdatesByItself(BOOL on) {
  if (MVPlaceIsBehind()) gByItselfHere = on;
  else [MVAppDefaults() setBool:on forKey:MVUpdatesByItself];
}

void MVTellApp(NSString *name, NSDictionary *_Nullable info) {
  if (MVPlaceIsBehind()) {
    if (!gTold) gTold = [NSMutableArray array];
    return [gTold addObject:@[name, info ?: @{}]];
  }
  [NSDistributedNotificationCenter.defaultCenter postNotificationName:name object:nil userInfo:info deliverImmediately:YES];
}

NSArray<NSArray *> *MVToldApp(void) {
  return gTold ?: @[];
}

static NSString *version(void) {
  return NSProcessInfo.processInfo.environment[@"APPDYNO_VERSION"] ?: NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"] ?
                                                                                                                                        : @"";
}

NSDictionary *MVAboutOptions(void) {
  char machine[64] = {0};
  size_t size = sizeof machine;
  sysctlbyname("hw.machine", machine, &size, NULL, 0);
  NSString *how = !MVInTheApp() ? @"Updated by appdyno update, from npm." : MVUpdatesByItselfOn() ? @"Updated from appdyno's signed releases on GitHub, looked for as it opens and once a day."
                                                                                                  : @"Updated from appdyno's signed releases on GitHub, looked for when you ask.";
  NSDictionary *look = @{NSFontAttributeName: [NSFont systemFontOfSize:11], NSForegroundColorAttributeName: NSColor.secondaryLabelColor};
  return @{NSAboutPanelOptionApplicationName: @"Appdyno",
           NSAboutPanelOptionApplicationVersion: version(),
           NSAboutPanelOptionVersion: MVFormat(MVInTheApp() ? @"The app, %@" : @"npm, %@", @[@(machine)]),
           NSAboutPanelOptionCredits: [[NSAttributedString alloc] initWithString:MVWord(how) attributes:look]};
}

@implementation MVSettings {
  MVOffscreenWindow *_window;
  NSButton *_byItself;
}

+ (instancetype)shared {
  static MVSettings *one;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    one = [MVSettings new];
  });
  return one;
}

- (NSWindow *)window {
  return _window;
}

- (void)show {
  if (!_window) [self make];
  _byItself.state = MVUpdatesByItselfOn() ? NSControlStateValueOn : NSControlStateValueOff;
  MVPresent(_window, MVPlaceIsBehind() ? MVShowBehind : MVShowFocused);
}

- (void)make {
  _window = [[MVOffscreenWindow alloc] initWithContentRect:NSMakeRect(0, 0, 460, 200) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
  _window.title = MVWord(@"Settings");
  _window.releasedWhenClosed = NO;
  _window.offscreen = MVPlaceIsBehind();
  _byItself = [NSButton checkboxWithTitle:MVWord(@"Check for updates automatically") target:self action:@selector(byItself:)];
  _byItself.identifier = @"updatesByItself";
  _byItself.enabled = MVInTheApp();
  NSTextField *about = MVParagraph(MVInTheApp() ? @"Appdyno looks for a new release as it opens and once a day, and installs one only when you say so." : @"This copy is updated by appdyno update, in a terminal.", MVStyleSub);
  NSButton *now = MVPlaceButton(@"Check Now", @"checkNow", self, @selector(checkNow:));
  now.enabled = [MVAppItems.shared canCheck];
  NSStackView *column = MVPlaceColumn(@[MVText(@"Updates", MVStyleHeading), _byItself, about, now], 10);
  column.edgeInsets = NSEdgeInsetsMake(20, 20, 20, 20);
  _window.contentView = column;
  [_window setContentSize:NSMakeSize(460, column.fittingSize.height)];
  [_window center];
}

- (void)byItself:(NSButton *)sender {
  MVSetUpdatesByItself(sender.state == NSControlStateValueOn);
}

- (void)checkNow:(id)sender {
  [MVAppItems.shared checkForUpdates:sender];
}

@end

@implementation MVAppItems {
  __weak MVHub *_hub;
}

+ (instancetype)shared {
  static MVAppItems *one;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    one = [MVAppItems new];
  });
  return one;
}

/// The hub's window shows what the app's process found, and asks it, as it opens, for a release it found already.
- (void)serveHub:(MVHub *)hub {
  _hub = hub;
  if (!MVInTheApp() || MVPlaceIsBehind()) return;
  __weak MVHub *weak = hub;
  [NSDistributedNotificationCenter.defaultCenter addObserverForName:MVUpdateAnswer
                                                             object:nil
                                                              queue:NSOperationQueue.mainQueue
                                                         usingBlock:^(NSNotification *note) {
                                                           [weak showUpdate:note.userInfo];
                                                         }];
  MVTellApp(MVUpdateWindowUp, nil);
}

- (BOOL)canCheck {
  return MVInTheApp() || _hub != nil;
}

- (void)about:(id)sender {
  [NSApp orderFrontStandardAboutPanelWithOptions:MVAboutOptions()];
}

- (void)checkForUpdates:(id)sender {
  if (MVInTheApp()) return MVTellApp(MVUpdateCheck, nil);
  // by npm: the hub runs `appdyno update --check`, and says what it found
  MVAskClients(@"update", @{});
}

- (void)settings:(id)sender {
  [MVSettings.shared show];
}

/// The project's pages, a Turkish one where the Mac speaks Turkish: each page has one.
static void openPage(NSString *english, NSString *turkish) {
  BOOL inTurkish = [MVWord(@"Help") isEqual:MVInTurkish(@"Help")];
  MVOpenOutside([kHome stringByAppendingString:inTurkish ? turkish : english]);
}

- (void)openDocs:(id)sender {
  openPage(@"#readme", @"/blob/main/README.tr.md");
}

- (void)openTools:(id)sender {
  openPage(@"/blob/main/docs/reference/tools.md", @"/blob/main/docs/reference/tools.tr.md");
}

- (void)reportIssue:(id)sender {
  openPage(@"/issues/new", @"/issues/new");
}

/// What cannot be done says why, where a person points at it.
- (BOOL)validateMenuItem:(NSMenuItem *)item {
  if (item.action != @selector(checkForUpdates:)) return YES;
  item.toolTip = self.canCheck ? nil : MVWord(@"This window is updated with appdyno update, in a terminal.");
  return self.canCheck;
}

@end

@implementation MVHub (Updates)

/// On the hub's window, where a person is: an offer to install, or what a look found.
- (void)showUpdate:(NSDictionary *)plain {
  if (_window.attachedSheet || ![plain[@"title"] isKindOfClass:NSString.class]) return;
  NSAlert *alert = [NSAlert new];
  alert.messageText = plain[@"title"];
  alert.informativeText = plain[@"text"] ?: @"";
  NSString *offer = [plain[@"offer"] isKindOfClass:NSString.class] && MVInTheApp() ? plain[@"offer"] : nil;
  [alert addButtonWithTitle:MVWord(offer ? @"Install and Restart" : @"OK")];
  if (offer) [alert addButtonWithTitle:MVWord(@"Later")];
  alert.buttons.firstObject.identifier = @"updateFirst";
  [alert beginSheetModalForWindow:_window
                completionHandler:^(NSModalResponse answer) {
                  if (offer) MVTellApp(answer == NSAlertFirstButtonReturn ? MVUpdateInstall : MVUpdateLater, @{@"version": offer});
                }];
  if (!MVPlaceIsBehind()) [NSApp requestUserAttention:NSInformationalRequest];
}

/// What the hub's own `appdyno update --check` said, for a copy run by npm.
- (void)heardUpdate:(NSString *)said {
  [self showUpdate:MVUpdateWords(said)];
}

@end
