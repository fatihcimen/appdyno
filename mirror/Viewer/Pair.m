// Two windows side by side: what this one says of the other, where it stands, and the flow both are to run.
#import "Viewer.h"
#import "Window.h"

static const double kBetween = 12, kFromTop = 24;

NSPoint MVBesideOrigin(NSRect room, NSSize size, BOOL left) {
  double x = NSMidX(room) + (left ? -size.width - kBetween / 2 : kBetween / 2);
  return NSMakePoint(MAX(x, NSMinX(room)), NSMaxY(room) - size.height - kFromTop);
}

@implementation MVWindow (Pair)

- (void)setPair:(NSDictionary *)message {
  BOOL ended = [message[@"ended"] boolValue], both = [message[@"both"] boolValue];
  NSString *with = message[@"with"] ?: @"the other";
  self.line.both = both;
  self.line.failing = message[@"failing"];
  self.line.pairing = ended ? nil : both ? @"To both" : @"Here only";
  NSButton *button = [self.bar buttonNamed:@"both"];
  button.enabled = !ended;
  [self.bar paint:@"both" symbol:@"link" color:both ? NSColor.controlAccentColor : NSColor.labelColor];
  button.toolTip = ended ? @"The other window has closed" : [NSString stringWithFormat:both ? @"Touches go here and to %@" : @"Touches stay here, and do not reach %@", with];
  [self showState];
}

- (void)placeBeside {
  NSWindow *window = self.nsWindow;
  NSString *side = self.look[@"pair"];
  if (!side || self.behind) return;
  [window setFrameOrigin:MVBesideOrigin((window.screen ?: NSScreen.mainScreen).visibleFrame, window.frame.size, [side isEqual:@"left"])];
}

- (void)askJourney {
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.message = self.look[@"pair"] ? @"A flow to run on both devices, one after the other" : @"A flow to run and measure";
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  panel.allowedFileTypes = @[@"flow"];
#pragma clang diagnostic pop
  [panel beginSheetModalForWindow:self.nsWindow completionHandler:^(NSModalResponse answer) {
    if (answer == NSModalResponseOK) MVEmitFrom(self.screenView, @{@"op": @"control", @"name": @"journey", @"file": panel.URL.path ?: @""});
  }];
}

@end
