// The Flow pane and what a click does there: what a window draws of a recording and an element, with no device.
#import "SelfTest.h"
#import "Window.h"

void MVCheckFlow(void) {
  id target = NSNull.null;
  MVFlowPane *pane = [[MVFlowPane alloc] initWithFrame:NSMakeRect(0, 0, 276, 600) target:target];
  MVCheck(@"flow: its record button is the table's", MVFindControl(pane, @"recordFlow") != nil, nil);
  MVCheck(@"flow: a click touches the device until a person says otherwise", pane.clickDoes == nil, nil);
  [pane chooseClick:@"copy"];
  MVCheck(@"flow: a click can copy", [pane.clickDoes isEqual:@"copy"], nil);
  [pane chooseClick:@"assert"];
  MVCheck(@"flow: a click can assert", [pane.clickDoes isEqual:@"assert"], nil);

  [pane show:@{@"on": @YES, @"starting": @NO, @"lines": @[@"launch", @"tap id=submit", @"tap x=1 y=2 !coordinates"], @"look": @[@"step 3: coordinates"]}];
  MVCheck(@"flow: the button stops what is recording", [pane.recordTitle isEqual:@"Stop"], pane.recordTitle);
  MVCheck(@"flow: each step has its row", pane.rows.count == 3 && [pane.rows[1].title isEqual:@"tap id=submit"], nil);
  MVCheck(@"flow: a step to look at says why, in words as well as a colour", [pane.rows[2].detail isEqual:@"coordinates"] && [pane.rows[2].symbol isEqual:@"exclamationmark.triangle"], pane.rows[2].detail);
  [pane show:@{@"on": @NO, @"starting": @YES, @"lines": @[]}];
  MVCheck(@"flow: a start can't be pressed twice", ![pane.recordTitle isEqual:@"Record"], pane.recordTitle);

  [pane showElement:@{@"role": @"button", @"label": @"Send", @"ref": @"@k3f9", @"id": @"submit", @"tap": @"tap id=submit", @"contrast": @[@"text contrast 2.1:1"]}];
  NSString *shown = pane.elementShown;
  MVCheck(@"flow: an element says its role, words, ref and id", [shown containsString:@"button Send"] && [shown containsString:@"@k3f9"] && [shown containsString:@"id submit"], shown);
  MVCheck(@"flow: an element says what a click writes, and its contrast", [shown containsString:@"tap id=submit"] && [shown containsString:@"2.1:1"], shown);
  [pane showElement:@{@"role": @"text", @"label": @"", @"ref": @"@a", @"tap": @"tap x=1 y=2", @"contrast": @[], @"contrastNote": @"Reading contrast"}];
  MVCheck(@"flow: contrast not yet read says so, and is no pass", [pane.elementShown containsString:@"Reading contrast"], pane.elementShown);
  [pane showElement:@{@"tap": @"tap x=1 y=2 !coordinates"}];
  MVCheck(@"flow: a place nothing names says a click there is coordinates", [pane.elementShown containsString:@"coordinates"], pane.elementShown);

  NSRect mark = MVMarkFrame(@{@"x": @0.1, @"y": @0.2, @"w": @0.5, @"h": @0.25}, CGSizeMake(200, 400));
  MVCheck(@"flow: a mark stands from the picture's top", fabs(mark.origin.x - 20) < 0.01 && fabs(mark.origin.y - 220) < 0.01 && fabs(mark.size.height - 100) < 0.01, NSStringFromRect(mark));

  NSPasteboard *board = [NSPasteboard pasteboardWithUniqueName];
  MVCopyText(@"id=submit", board);
  MVCheck(@"flow: what is copied is on the pasteboard", [[board stringForType:NSPasteboardTypeString] isEqual:@"id=submit"], nil);
  [board releaseGlobally];
}
