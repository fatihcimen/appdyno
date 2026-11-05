// A window's part in a recording and in what is under the pointer: the parent reads and writes, the pane says what it
// is told, and this keeps the two and the picture in step.
#import "Viewer.h"
#import "Window.h"

@implementation MVWindow (Flow)

/// The pointer is asked about only while the Flow pane shows: an element's read costs the device.
- (void)watchElements {
  MVFlowPane *pane = self.inspector.flow;
  MVView *view = (MVView *)self.screenView;
  BOOL wanted = self.inspecting && self.inspector.flowing;
  view.clickDoes = wanted ? pane.clickDoes : nil;
  view.inspects = wanted;
  if (wanted == pane.looking) return;
  pane.looking = wanted;
  if (!wanted) [view showMark:nil];
  MVEmit(@{@"op": @"inspect", @"on": @(wanted)});
}

- (void)chooseClick:(NSString *)does {
  [self.inspector.flow chooseClick:does];
}

- (void)showFlow:(NSDictionary *)message {
  MVFlowPane *pane = self.inspector.flow;
  BOOL on = [message[@"on"] boolValue];
  // a recording is for watching: its steps come up beside the device
  if (on && !pane.recording) [self showPane:MVPaneFlow];
  pane.recording = on;
  NSButton *button = MVFindControl(self.bar, @"recordFlow");
  button.image = [NSImage imageWithSystemSymbolName:on ? @"hand.tap.fill" : @"hand.tap" accessibilityDescription:on ? @"Stop Recording Flow" : MVControlTitle(@"recordFlow")];
  button.contentTintColor = on ? NSColor.systemRedColor : NSColor.labelColor;
  [pane show:message];
}

- (void)showElement:(NSDictionary *)message {
  [(MVView *)self.screenView showMark:message[@"rect"]];
  [self.inspector.flow showElement:message];
}

@end
