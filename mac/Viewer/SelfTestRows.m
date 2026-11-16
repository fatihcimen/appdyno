// A row of a list in a device's window, chosen by a message: in the test build alone, for what looks at a pane with a
// row chosen in it. A table in a window kept behind takes a test's click on some versions of macOS and not on others.
#import "SelfTest.h"
#import "Viewer.h"
#import "Window.h"
#import <objc/runtime.h>

/// The list that shows, under a view, with a row of that title.
static MVList *_Nullable listWith(NSView *view, NSString *title) {
  if (view.isHiddenOrHasHiddenAncestor) return nil;
  if ([view isKindOfClass:MVList.class] && [[((MVList *)view).rows valueForKey:@"title"] containsObject:title]) return (MVList *)view;
  for (NSView *child in view.subviews) {
    MVList *found = listWith(child, title);
    if (found) return found;
  }
  return nil;
}

@implementation MVStage (Rows)

+ (void)load {
  method_exchangeImplementations(class_getInstanceMethod(self, @selector(poke:)), class_getInstanceMethod(self, @selector(pokeOrRow:)));
}

/// `row` names a row by what it says; every other poke is the stage's own.
- (void)pokeOrRow:(NSDictionary *)m {
  NSString *title = [m[@"row"] isKindOfClass:NSString.class] ? m[@"row"] : nil;
  // exchanged at load: this is the stage's own `poke:`
  if (!title) return [self pokeOrRow:m];
  MVWindow *window = [self valueForKey:@"_window"];
  MVList *list = listWith(window.nsWindow.contentView, title);
  if (list) MVPokeListRow(list, title);
  MVEmit(@{@"op": @"clicked", @"name": title, @"found": @(list != nil)});
}

@end
