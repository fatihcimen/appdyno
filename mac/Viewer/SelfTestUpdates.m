// About, Check for Updates and Settings, in the menu of every window, and what a look for a release says on the hub's.
#import "HubParts.h"
#import "SelfTest.h"
#import "Settings.h"
#import "Updates.h"
#import "Words.h"

static NSMenuItem *_Nullable itemTitled(NSMenu *menu, NSString *english) {
  for (NSMenuItem *item in menu.itemArray)
    if ([item.title isEqual:MVWord(english)]) return item;
  return nil;
}

static void checkWords(void) {
  NSDictionary *offer = MVUpdateWords(@"installed: 1.2.0, installed by the app, at /A\nlatest: 1.3.1\nwould download https://x/A.dmg, verify it, then replace this app; nothing was changed");
  MVCheck(@"updates: a newer release is offered by its version, with the one installed", [offer[@"offer"] isEqual:@"1.3.1"] && [offer[@"text"] containsString:@"1.2.0"], offer.description);
  NSDictionary *npm = MVUpdateWords(@"installed: 1.3.0, installed by npm, at /B\nlatest: 1.3.1\nwould verify appdyno@1.3.1, then upgrade it with npm; nothing was changed");
  MVCheck(@"updates: and so by npm", [npm[@"offer"] isEqual:@"1.3.1"], npm.description);
  NSDictionary *latest = MVUpdateWords(@"installed: 1.3.1, installed by the app, at /A\nlatest: 1.3.1\nnothing to do: 1.3.1 is the latest release");
  MVCheck(@"updates: the latest says it is up to date, by its version", !latest[@"offer"] && [latest[@"title"] isEqual:MVWord(@"You're up to date")] && [latest[@"text"] containsString:@"1.3.1"], latest.description);
  NSDictionary *moved = MVUpdateWords(@"installed: 1.3.0, an app not yet in Applications, at /Volumes/Appdyno\nlatest: 1.3.1\nwould refuse: appdyno here is an app not yet in Applications (UNSUPPORTED)\n  drag Appdyno to Applications, and open it from there");
  MVCheck(@"updates: an app run from its disk image says why it cannot update, and what to do", !moved[@"offer"] && [moved[@"text"] containsString:MVCapitalized(MVSentence(@"drag Appdyno to Applications, and open it from there"))], moved.description);
  NSDictionary *offline = MVUpdateWords(@"asking for https://github.com: ENOTFOUND");
  MVCheck(@"updates: a look that failed says so, with what it met", !offline[@"offer"] && [offline[@"text"] containsString:@"ENOTFOUND"], offline.description);
}

static void checkMenu(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  NSMenu *app = MVHubMenu(hub).itemArray.firstObject.submenu;
  NSMenuItem *about = itemTitled(app, @"About Appdyno"), *check = itemTitled(app, @"Check for Updates…"), *settings = itemTitled(app, @"Settings…");
  NSMenuItem *hide = itemTitled(app, @"Hide Appdyno"), *others = itemTitled(app, @"Hide Others"), *quit = itemTitled(app, @"Quit Appdyno");
  BOOL own = about.target == MVAppItems.shared && check.target == MVAppItems.shared && settings.target == MVAppItems.shared;
  MVCheck(@"menu: the app's menu has About, Check for Updates and Settings, as a Mac app's has", own && [settings.keyEquivalent isEqual:@","] && itemTitled(app, @"Show All") && itemTitled(app, @"Services").submenu, [[app.itemArray valueForKey:@"title"] componentsJoinedByString:@"|"]);
  NSMenu *window = MVMainMenu(nil).itemArray.firstObject.submenu;
  BOOL same = itemTitled(window, @"About Appdyno").target == MVAppItems.shared && itemTitled(window, @"Check for Updates…").target == MVAppItems.shared && itemTitled(window, @"Settings…").target == MVAppItems.shared;
  MVCheck(@"menu: a device's own window has the same About, Check for Updates and Settings", same, [[window.itemArray valueForKey:@"title"] componentsJoinedByString:@"|"]);
  MVCheck(@"menu: and the system's own, by their keys", [hide.keyEquivalent isEqual:@"h"] && others.keyEquivalentModifierMask == (NSEventModifierFlagCommand | NSEventModifierFlagOption) && [quit.keyEquivalent isEqual:@"q"], nil);
  setenv("APPDYNO_VERSION", "9.8.7", 1);
  NSDictionary *options = MVAboutOptions();
  MVCheck(@"about: it says the version, and how this copy is updated", [options[NSAboutPanelOptionApplicationVersion] isEqual:@"9.8.7"] && [[options[NSAboutPanelOptionCredits] string] isEqual:MVWord(@"Updated by appdyno update, from npm.")], options.description);
}

static void checkHub(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  NSWindow *window = hub.room.window;
  NSMutableArray<NSDictionary *> *asked = [NSMutableArray array];
  MVTapAsks(^(NSDictionary *message) {
    [asked addObject:message];
  });
  [MVAppItems.shared checkForUpdates:nil];
  MVCheck(@"updates: by npm, the hub's window asks the hub to look", [asked.lastObject[@"do"] isEqual:@"update"], asked.description);
  [hub showClients:@{@"update": @"installed: 1.3.0, installed by npm, at /B\nlatest: 1.3.1\nwould verify appdyno@1.3.1, then upgrade it with npm; nothing was changed"}];
  MVPump(0.2);
  NSButton *first = MVFindControl(window.attachedSheet.contentView, @"updateFirst");
  MVCheck(@"updates: what it found stands on the window, with nothing to install where the app is not", window.attachedSheet && [first.title isEqual:MVWord(@"OK")], first.title);
  if (window.attachedSheet) [window endSheet:window.attachedSheet];
  MVPump(0.2);
  // run from the app: its process looks, the window shows its offer, and the person's yes goes back to it
  setenv("APPDYNO_HELPERS", "/Applications/Appdyno.app/Contents/Helpers", 1);
  NSUInteger told = MVToldApp().count;
  [MVAppItems.shared checkForUpdates:nil];
  MVCheck(@"updates: from the app, the app's own process is asked", [MVToldApp().lastObject[0] isEqual:MVUpdateCheck] && MVToldApp().count == told + 1, nil);
  [hub showUpdate:MVUpdateWords(@"installed: 1.3.0, installed by the app, at /A\nlatest: 1.3.1\nwould download https://x/A.dmg, verify it, then replace this app; nothing was changed")];
  MVPump(0.2);
  first = MVFindControl(window.attachedSheet.contentView, @"updateFirst");
  MVCheck(@"updates: an offer stands on the hub's window, to install and restart", [first.title isEqual:MVWord(@"Install and Restart")], first.title);
  [first performClick:nil];
  MVPump(0.3);
  NSArray *install = MVToldApp().lastObject;
  MVCheck(@"updates: and the person's yes goes to the app, for that version", !window.attachedSheet && [install[0] isEqual:MVUpdateInstall] && [install[1][@"version"] isEqual:@"1.3.1"], [install description]);
  MVCheck(@"about: from the app, it says a look is made daily", [[MVAboutOptions()[NSAboutPanelOptionCredits] string] isEqual:MVWord(@"Updated from appdyno's signed releases on GitHub, looked for as it opens and once a day.")], nil);
  [MVSettings.shared show];
  NSButton *byItself = MVFindControl(MVSettings.shared.window.contentView, @"updatesByItself");
  [byItself performClick:nil];
  MVCheck(@"settings: the switch turns the daily look off, and About says so", byItself.enabled && !MVUpdatesByItselfOn() && [[MVAboutOptions()[NSAboutPanelOptionCredits] string] isEqual:MVWord(@"Updated from appdyno's signed releases on GitHub, looked for when you ask.")], nil);
  [byItself performClick:nil];
  [MVSettings.shared.window close];
  unsetenv("APPDYNO_HELPERS");
  MVTapAsks(nil);
}

void MVCheckUpdates(void) {
  checkWords();
  checkMenu();
  checkHub();
}
