// A device window's bar, as AppKit measures it: each item's view with its size as it is made, and a name that comes later
// with its room.
#import "SelfTest.h"
#import "Window.h"

/// The bar measures each item's view as it is made: one of no size, as a title with no name yet, was a warning each run.
static void checkBarSizes(void) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": @"x",
                      @"look": @{@"controls": @[@"home", @"lock"]}}];
  MVToolbar *bar = [window valueForKey:@"_bar"];
  NSToolbar *toolbar = [bar toolbar];
  NSMutableArray<NSString *> *unsized = [NSMutableArray array];
  for (NSString *name in [bar toolbarDefaultItemIdentifiers:toolbar]) {
    NSToolbarItem *item = [bar toolbar:toolbar itemForItemIdentifier:name willBeInsertedIntoToolbar:NO];
    NSArray<NSToolbarItem *> *items = item ? @[item] : @[];
    if ([item isKindOfClass:NSToolbarItemGroup.class]) items = ((NSToolbarItemGroup *)item).subitems;
    for (NSToolbarItem *one in items) {
      NSSize size = one.view.fittingSize;
      if (one.view && (size.width <= 0 || size.height <= 0)) [unsized addObject:one.itemIdentifier];
    }
  }
  MVCheck(@"bar: each item's view has its size as it is made, the title with no name yet too", !unsized.count, [unsized componentsJoinedByString:@"|"]);
}

/// The bar measures its title before the device has told its name: a name that comes later has its room all the same.
static void checkBarTitle(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:YES];
  [hub show:@{@"devices": @[@{@"id": @"emulator-5554", @"serial": @"emulator-5554", @"name": @"appdyno-example-1", @"kind": @"emulator", @"state": @"running", @"platform": @"android", @"model": @"Pixel 7", @"detail": @"Pixel 7"}],
              @"kinds": @[@{@"kind": @"emulator"}]}];
  MVTapEmits(^(__unused NSDictionary *message){});
  MVWindow *window = [[MVWindow alloc] initInRoom:hub.room];
  window.behind = YES;
  [window configure:@{@"title": @"emulator-5554",
                      @"stage": @"emulator-5554",
                      @"look": @{@"frame": @{@"platform": @"android"}, @"controls": @[@"back", @"home", @"appSwitch", @"lock"]}}];
  [window setPicture:CGSizeMake(1080, 2400)];
  [window useToolbar];
  [hub.room.window setContentSize:NSMakeSize(1240, 820)];
  [hub.room.window layoutIfNeeded];
  MVPump(0.2);
  MVTapEmits(nil);
  NSMutableArray<NSString *> *cut = [NSMutableArray array];
  for (NSString *key in @[@"_name", @"_about"]) {
    NSTextField *words = [[window valueForKey:@"_bar"] valueForKey:key];
    CGFloat needs = [words.cell cellSizeForBounds:NSMakeRect(0, 0, 10000, 100)].width;
    if (!words.window || NSWidth(words.frame) + 1 < needs) [cut addObject:[NSString stringWithFormat:@"%@ (%.0f of %.0f)", words.stringValue, NSWidth(words.frame), needs]];
  }
  MVCheck(@"bar: a name that comes after the bar was made is whole where the bar has the room", !cut.count, [cut componentsJoinedByString:@"|"]);
  [hub.room.window orderOut:nil];
}

void MVCheckBar(void) {
  checkBarSizes();
  checkBarTitle();
}
