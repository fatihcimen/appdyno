// The Network pane at the Inspector's width, in both of the window's languages: no word of the window's own is cut,
// and nothing stands past the pane's edge. What an app or a server sent, such as a path, is theirs and may be cut.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

/// Every label and button under a view that shows and has not the room for its words, as `words (has of needs)`.
static void cut(NSView *view, NSView *pane, NSMutableArray<NSString *> *found) {
  if (view.isHiddenOrHasHiddenAncestor || [view isKindOfClass:NSTextView.class]) return;
  // where it stands by its own measure: a label's frame reaches a little past its words on each side
  NSRect at = view.superview ? [view.superview convertRect:[view alignmentRectForFrame:view.frame] toView:pane] : view.bounds;
  NSString *words = nil;
  CGFloat needs = 0;
  if ([view isKindOfClass:NSButton.class]) {
    words = ((NSButton *)view).title;
    needs = words.length ? view.intrinsicContentSize.width : 0;
  } else if ([view isKindOfClass:NSTextField.class] && !((NSTextField *)view).editable) {
    NSTextField *field = (NSTextField *)view;
    // words of the window's own: a row's words, an address and a figure are what was sent, and are marked as that
    BOOL own = ![field respondsToSelector:NSSelectorFromString(@"content")] || ![[field valueForKey:@"content"] boolValue];
    words = own ? field.stringValue : nil;
    needs = field.maximumNumberOfLines == 1 || field.cell.usesSingleLineMode || !field.cell.wraps ? [field.cell cellSizeForBounds:NSMakeRect(0, 0, 10000, 100)].width : 0;
  }
  if (words.length && (needs > NSWidth(view.frame) + 1 || NSMinX(at) < -0.5 || NSMaxX(at) > NSWidth(pane.bounds) + 0.5)) [found addObject:[NSString stringWithFormat:@"%@ (%.0f of %.0f at %.0f)", words, NSWidth(at), needs, NSMinX(at)]];
  for (NSView *child in view.subviews) cut(child, pane, found);
}

void MVCheckNetworkFits(MVWindow *window, MVNetworkPane *pane) {
  NSArray<NSDictionary *> *requests = @[@{@"id": @1,
                                          @"method": @"DELETE",
                                          @"url": @"https://api.example.test:8443/v1/coupons/SPRING-2026/redeem",
                                          @"status": @404,
                                          @"ms": @12,
                                          @"bytes": @420},
                                        @{@"id": @2,
                                          @"method": @"POST",
                                          @"url": @"https://pay.example.test/v1/pay",
                                          @"status": @500,
                                          @"ms": @37296}];
  NSArray<NSDictionary *> *rules = @[@{@"rule": @"\"pay.example.test/v1/pay\" method=POST status=503",
                                       @"id": @"aa1111",
                                       @"hits": @12,
                                       @"fields": @{@"method": @"POST", @"host": @"pay.example.test", @"path": @"/v1/pay", @"status": @"503"}}];
  NSDictionary *probing = @{@"op": @"network",
                            @"capturing": @"probe",
                            @"since": @(NSDate.date.timeIntervalSince1970 * 1000 - 4000000),
                            @"bodies": @YES,
                            @"throttle": @"3g",
                            @"total": @12345,
                            @"rules": rules,
                            @"entries": requests};
  NSDictionary *parts = @{@"id": @2,
                          @"lines": @[],
                          @"request": requests[1],
                          @"kept": @YES,
                          @"timings": @{@"dns": @11, @"connect": @120, @"tls": @240, @"wait": @36000, @"receive": @925},
                          @"requestHeaders": @[],
                          @"responseHeaders": @[],
                          @"responseBody": @"{\"error\":\"card_declined\"}"};
  for (NSNumber *turkish in @[@NO, @YES]) {
    MVTestTurkish(turkish.boolValue);
    // the words of a pane are set as it is made: one of its own, at the Inspector's width, for each language
    MVNetworkPane *fresh = [[MVNetworkPane alloc] initWithFrame:NSMakeRect(0, 0, MVInspectorWidth - 32, 640)];
    fresh.onSend = ^(__unused NSDictionary *message) {
    };
    [window.nsWindow.contentView addSubview:fresh];
    NSMutableArray<NSString *> *found = [NSMutableArray array];
    void (^state)(NSString *) = ^(NSString *name) {
      [fresh layoutSubtreeIfNeeded];
      NSMutableArray<NSString *> *here = [NSMutableArray array];
      cut(fresh, fresh, here);
      // the capture's own line is made here of a time and a count, and is the window's to keep whole
      NSTextField *line = [fresh valueForKey:@"_state"];
      if (!line.isHiddenOrHasHiddenAncestor && [line.cell cellSizeForBounds:NSMakeRect(0, 0, 10000, 100)].width > NSWidth(line.bounds) + 1) [here addObject:line.stringValue];
      NSView *tool = fresh.titleTool;
      if (here.count) [found addObject:[NSString stringWithFormat:@"%@: %@", name, [here componentsJoinedByString:@", "]]];
      if (!tool) [found addObject:[name stringByAppendingString:@": no tool"]];
    };
    [fresh show:@{@"op": @"network",
                  @"capturing": @NO,
                  @"ways": @[],
                  @"needs": @"An iPhone's requests show only through an HTTP proxy you run, set in the iPhone's Wi-Fi settings, and then they show here. This window changes no setting on a phone."}];
    state(@"needs");
    [fresh show:@{@"op": @"network",
                  @"capturing": @NO,
                  @"ways": @[@"probe", @"proxy"],
                  @"proxy": @"127.0.0.1:9090"}];
    state(@"empty");
    [fresh show:@{@"op": @"network",
                  @"capturing": @"probe",
                  @"since": probing[@"since"],
                  @"throttle": @"full",
                  @"rules": @[],
                  @"entries": @[],
                  @"unseen": @{@"webview": @2, @"background": @1, @"websocket": @3}}];
    state(@"listening");
    [fresh show:probing];
    fresh.filter.failedOnly = YES;
    state(@"list");
    fresh.filter.failedOnly = NO;
    [[fresh valueForKey:@"_list"] selectKey:@"2"];
    [fresh show:@{@"op": @"network", @"detail": parts}];
    state(@"request");
    [fresh show:@{@"op": @"answer",
                  @"ok": @NO,
                  @"text": @"The probe restarts the app: stop the recording first, or wait for the measure to end",
                  @"hint": @"allow it by --allow-urls with pay.example.test in it"}];
    state(@"refused");
    MVSegments *sections = [fresh valueForKey:@"_sections"];
    sections.chosen = 1;
    sections.onChoose(1);
    state(@"rules");
    NSButton *open = MVFindControl(fresh, @"networkRule.0");
    [open sendAction:open.action to:open.target];
    state(@"rule open");
    [fresh show:@{@"op": @"network",
                  @"capturing": @"probe",
                  @"since": probing[@"since"],
                  @"elsewhere": @YES,
                  @"rules": @[],
                  @"entries": requests}];
    state(@"rule changed elsewhere");
    sections.chosen = 0;
    sections.onChoose(0);
    [fresh show:@{@"op": @"network",
                  @"capturing": @NO,
                  @"was": @"probe",
                  @"ways": @[@"probe"],
                  @"entries": requests,
                  @"total": @2}];
    state(@"stopped");
    MVCheck([NSString stringWithFormat:@"fits: at the Inspector's width no word of the pane is cut and nothing stands past its edge, in %@", turkish.boolValue ? @"Turkish" : @"English"], found.count == 0, [found componentsJoinedByString:@" | "]);
    [fresh removeFromSuperview];
  }
  MVTestTurkish(NO);
  [pane show:@{@"op": @"answer",
               @"ok": @NO,
               @"text": @"a rule sends requests only to this Mac or its own network, and example.org is neither",
               @"hint": @"allow it by --allow-urls with example.org in it"}];
  MVCheck(@"refused: what a person's settings do not allow stays at the pane's foot with what would allow it", [pane.answer.said hasPrefix:@"a rule sends requests only to this Mac"] && [pane.answer.hint containsString:@"--allow-urls"] && MVStands(pane.answer, pane), pane.answer.hint);
}
