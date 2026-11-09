// The maths of a window, with no window: frames, zoom, the controls' table, gestures and composed text.
#import "SelfTest.h"
#import "Window.h"

static BOOL near(double a, double b) {
  return fabs(a - b) < 0.01;
}

static void checkTable(void) {
  CGSize tall = CGSizeMake(1206, 2622);
  MVFrameSpec pro = MVFrameSpecOf(@"iPhone 17 Pro", @"ios", nil, tall);
  MVCheck(@"frame: an iPhone 17 Pro's corners and island", near(pro.radius, 62) && pro.cutout == MVCutoutIsland, nil);
  MVCheck(@"frame: Actual Size is the device's points", near(pro.points, 402), nil);
  MVFrameSpec older = MVFrameSpecOf(@"iPhone 13 Pro Max", @"ios", @"#1f4e79", CGSizeMake(1284, 2778));
  MVCheck(@"frame: a notch, and a colour where it is known", older.cutout == MVCutoutNotch && near(older.radius, 53.33) && older.color == 0x1f4e79, nil);
  MVFrameSpec compact = MVFrameSpecOf(@"iPhone SE (3rd generation)", @"ios", nil, CGSizeMake(750, 1334));
  MVCheck(@"frame: a Home button makes a chin and square corners", compact.chin > 0 && compact.radius == 0 && compact.cutout == MVCutoutHomeButton, nil);
  MVFrameSpec tablet = MVFrameSpecOf(@"iPad Pro 11-inch (M5)", @"ios", nil, CGSizeMake(1668, 2420));
  MVCheck(@"frame: an iPad's side button is on its top edge", tablet.keys[0].edge == MVEdgeTop && near(tablet.radius, 30), nil);
  MVFrameSpec android = MVFrameSpecOf(@"sdk_gphone64_arm64", @"android", @"nonsense", CGSizeMake(1080, 2400));
  MVCheck(@"frame: an unknown Android has its own frame, and a bad colour is ignored", android.cutout == MVCutoutHole && android.color != 0, nil);
}

static void checkLayout(void) {
  CGSize tall = CGSizeMake(402, 874);
  MVFrameSpec spec = MVFrameSpecOf(@"iPhone 17 Pro", @"ios", nil, CGSizeMake(1206, 2622));
  MVFrameLayout upright = MVLayOutFrame(spec, tall);
  MVCheck(@"frame: the screen sits in the middle of its body", near(upright.screen.origin.x, (upright.body.width - tall.width) / 2) && near(upright.screen.origin.y, (upright.body.height - tall.height) / 2), nil);
  MVCheck(@"frame: at one point a point it scales by one", near(upright.unit, 1), nil);
  MVCheck(@"frame: the body's corners wrap the screen's", upright.outer > upright.radius, nil);
  MVFrameLayout doubled = MVLayOutFrame(spec, CGSizeMake(804, 1748));
  MVCheck(@"frame: it scales with its picture", near(doubled.body.width, upright.body.width * 2), nil);
  CGRect up = MVFrameKeyRect(upright, spec.keys[1]), side = MVFrameKeyRect(upright, spec.keys[3]);
  MVCheck(@"frame: keys stand proud of the body, left and right", up.origin.x < 0 && CGRectGetMaxX(side) > upright.body.width, nil);
  MVFrameLayout turned = MVLayOutFrame(spec, CGSizeMake(874, 402));
  CGRect key = MVFrameKeyRect(turned, spec.keys[1]);
  MVCheck(@"frame: turned, a key stays on the body's edge", key.size.width > key.size.height && CGRectGetMaxY(key) > turned.body.height, NSStringFromRect(key));
  CGRect island = MVCutoutRect(spec, tall);
  MVCheck(@"frame: the island as a simulator's own picture has it", near(island.size.width, 126) && near(island.size.height, 37) && near(CGRectGetMidX(island), 201), nil);
}

static void checkZoom(void) {
  MVCheck(@"zoom: fit takes the tighter side", near(MVFitScale(CGSizeMake(100, 200), CGSizeMake(400, 100)), 0.5), nil);
  double in = MVZoomStep(1, YES), out = MVZoomStep(in, NO);
  MVCheck(@"zoom: a step up and down comes back", in > 1 && near(out, 1), nil);
  MVCheck(@"zoom: a step from anywhere lands on a round step", near(MVZoomStep(1.01, YES), in), nil);
}

static void checkControls(void) {
  NSMutableArray *names = [NSMutableArray array];
  NSArray *listed = @[@"home", @"lock", @"volumeUp", @"volumeDown"];
  for (NSMenuItem *item in MVControlMenu(@"Device", listed).itemArray) [names addObject:item.representedObject];
  MVCheck(@"menu: a kind's own controls, by their names", [names isEqual:listed], names.description);
  NSUInteger shortcuts = 0;
  NSMutableSet *seen = [NSMutableSet set];
  NSArray *android = @[@"back", @"home", @"appSwitch", @"lock", @"volumeUp", @"volumeDown", @"quickSettings", @"notifications", @"rotateLeft", @"rotateRight"];
  NSMutableArray *menus = [NSMutableArray arrayWithArray:@[MVControlMenu(@"File", nil), MVControlMenu(@"Edit", nil), MVControlMenu(@"View", nil), MVControlMenu(@"Device", android)]];
  for (NSMenu *menu in menus) {
    for (NSMenuItem *item in menu.itemArray) {
      if (!item.keyEquivalent.length) continue;
      shortcuts++;
      [seen addObject:[NSString stringWithFormat:@"%@ %lu", item.keyEquivalent, (unsigned long)item.keyEquivalentModifierMask]];
    }
  }
  MVCheck(@"menu: no two controls share a shortcut", seen.count == shortcuts, nil);
  MVCheck(@"menu: every control has its symbol", MVControlImage(@"home") && MVControlImage(@"rotateLeft") && MVControlImage(@"controlCenter"), nil);
}

static void checkLive(void) {
  MVCheck(@"hud: a low rate with every frame on time is no fault", MVFramesState(@{@"fps": @20,
                                                                                   @"framesDrawn": @20,
                                                                                   @"jankyFrames": @0}) == MVLiveGood,
          nil);
  MVCheck(@"hud: a rate is judged by what came late", MVFramesState(@{@"framesDrawn": @20,
                                                                      @"jankyFrames": @4}) == MVLiveWarning &&
                                                          MVFramesState(@{@"framesDrawn": @12,
                                                                          @"jankyFrames": @10}) == MVLiveCritical,
          nil);
  MVCheck(@"hud: with no count of late frames there is no verdict", MVFramesState(@{@"fps": @12}) == MVLiveNeutral, nil);
  MVCheck(@"hud: one frozen frame is poor", MVStateOf(@"frozenFrames", 1) == MVLiveCritical && MVStateOf(@"frozenFrames", 0) == MVLiveGood, nil);
  MVCheck(@"hud: memory has no threshold to be judged by", MVStateOf(@"memoryMb", 4000) == MVLiveNeutral, nil);
  MVHud *hud = [[MVHud alloc] initWithFrame:NSMakeRect(0, 0, 180, 600)];
  [hud show:@{@"sample": @{@"at": @1, @"fps": @0, @"absent": @{@"cpuPercent": @"cannot measure CPU"}},
              @"noise": @[@"mirrored"]}];
  MVCheck(@"hud: a device that counted no frames shows a still screen, no fault", [[hud shownFor:@"fps"] isEqual:@"Still"], [hud shownFor:@"fps"]);
  [hud setPictureRate:0];
  [hud show:@{@"sample": @{@"at": @2}}];
  MVCheck(@"hud: a still picture is still, and no fault", [[hud shownFor:@"fps"] isEqual:@"Still"], [hud shownFor:@"fps"]);
  [hud setPictureRate:58];
  [hud show:@{@"sample": @{@"at": @3}}];
  MVCheck(@"hud: with no count from the device, the picture's own rate", [[hud shownFor:@"fps"] isEqual:@"58 fps"], [hud shownFor:@"fps"]);
  [hud show:@{@"sample": @{@"at": @4, @"fps": @30}}];
  MVCheck(@"hud: a device's own count comes first", [[hud shownFor:@"fps"] isEqual:@"30 fps"], [hud shownFor:@"fps"]);
  [hud show:@{@"sample": @{@"at": @4, @"fps": @20, @"absent": @{@"fps": @"the display, not the app"}}}];
  MVCheck(@"hud: what a source says of a reading stands beside it", [[hud whyFor:@"fps"] isEqual:@"the display, not the app"], [hud whyFor:@"fps"]);
  [hud show:@{@"sample": @{@"at": @5, @"absent": @{@"cpuPercent": @"cannot measure CPU"}}}];
  MVCheck(@"hud: a measure a device cannot give is a dash, never 0", [[hud shownFor:@"cpuPercent"] isEqual:@"\u2013"], [hud shownFor:@"cpuPercent"]);
}

static void checkMeasures(void) {
  MVPerfPane *pane = [[MVPerfPane alloc] initWithFrame:NSMakeRect(0, 0, 276, 600) target:NSNull.null];
  MVCheck(@"performance: a measure's control is the table's", MVFindControl(pane, @"measureLaunch") != nil && MVFindControl(pane, @"dashboard") != nil, nil);
  [pane show:@{@"sample": @{@"at": @1, @"memoryMb": @123, @"cpuPercent": @9.25, @"absent": @{@"fps": @"cannot count frames here"}}}];
  MVCheck(@"performance: readings stand as the cards say them", [[pane shownFor:@"memoryMb"] isEqual:@"123 MB"] && [[pane shownFor:@"cpuPercent"] isEqual:@"9.2 %"], [pane shownFor:@"cpuPercent"]);
  MVCheck(@"performance: a reading a device cannot give is a dash", [[pane shownFor:@"fps"] isEqual:@"\u2013"], [pane shownFor:@"fps"]);
  [pane showMeasuring:@"round 1 of 3"];
  MVCheck(@"performance: no second measure over the first", !MVFindControl(pane, @"measureScroll").enabled, nil);
  [pane showMeasured:@{@"ok": @YES,
                       @"title": @"Cold launch",
                       @"value": @"412 ms",
                       @"detail": @"dev.app"}];
  MVCheck(@"performance: a measure's result stands, and the next can start", [pane.lastResult containsString:@"412 ms"] && MVFindControl(pane, @"measureScroll").enabled, pane.lastResult);
  [pane showMeasured:@{@"ok": @YES,
                       @"flagged": @YES,
                       @"title": @"Scroll",
                       @"value": @"72% jank",
                       @"detail": @"3 rounds"}];
  MVCheck(@"performance: that a measure ran is no verdict, and what its tool found is marked", pane.lastMarked, nil);
  MVCheck(@"performance: a second result reaches the list, not only its rows", ((NSTableView *)((MVList *)[pane valueForKey:@"_results"]).documentView).numberOfRows == 2, nil);
  NSTextField *app = [pane valueForKey:@"_app"];
  [pane showHistory:@{@"results": @[], @"app": @"Fixture"}];
  [pane showMeasured:@{@"ok": @YES, @"title": @"Cold launch", @"value": @"412 ms", @"detail": @"median of 5"}];
  MVCheck(@"performance: the pane names the app in front, which a measure restarts", [app.stringValue containsString:@"Fixture"] && pane.lastResult.length, app.stringValue);
  [pane showHistory:@{@"results": @[]}];
  MVCheck(@"performance: with no app of a person's in front it asks for one, and what was measured of another goes", [app.stringValue hasPrefix:@"Open an app"] && !pane.lastResult.length, app.stringValue);
  NSArray *before = @[@{@"title": @"Cold launch", @"value": @"400 ms"}];
  [pane showMeasured:@{@"ok": @YES, @"flagged": @YES, @"kept": @NO, @"title": @"Scroll", @"value": @"too few frames", @"detail": @"1 of 3 rounds"}];
  [pane showHistory:@{@"results": before}];
  MVCheck(@"performance: a result the Mac kept no number of stays over what it kept before", [pane.lastResult containsString:@"too few frames"], pane.lastResult);
  [pane showMeasured:@{@"ok": @YES, @"kept": @YES, @"title": @"Cold launch", @"value": @"412 ms"}];
  [pane showHistory:@{@"results": @[@{@"title": @"Cold launch", @"value": @"412 ms"}, before[0]]}];
  MVCheck(@"performance: one it kept is shown once, as the Mac keeps it", ((NSTableView *)((MVList *)[pane valueForKey:@"_results"]).documentView).numberOfRows == 3, nil);
  NSTextField *hint = [pane valueForKey:@"_hint"];
  [pane showMeasured:@{@"title": @"No measure", @"detail": @"relaunched with the frame probe", @"hint": @"open the screen to measure again"}];
  MVCheck(@"performance: a refusal says under the measures what to do next", !hint.hidden && [hint.stringValue isEqual:@"Open the screen to measure again"], hint.stringValue);
  [pane showMeasuring:@"round 1 of 3"];
  MVCheck(@"performance: and stops saying it once the next measure starts", hint.hidden, nil);
}

/// In a window that has been drawn, as a view with no window has no layer to give an animation to.
static NSView *resultsCardOf(MVPerfPane *pane, NSWindow **holder) {
  *holder = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 320, 700) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  [(*holder).contentView addSubview:pane];
  [*holder display];
  return [pane valueForKey:@"_resultsCard"];
}

static MVPerfPane *newPane(void) {
  return [[MVPerfPane alloc] initWithFrame:NSMakeRect(0, 0, 276, 600) target:NSNull.null];
}

static void checkFirstResult(void) {
  NSWindow *holder;
  MVPerfPane *pane = newPane();
  NSView *card = resultsCardOf(pane, &holder);
  [pane showHistory:@{@"results": @[@{@"title": @"Cold launch", @"value": @"400 ms"}]}];
  [holder display];
  MVCheck(@"performance: a window opening on old results shows them, and nothing comes in", card.layer && !card.hidden && ![card.layer animationForKey:@"fade"], nil);
  pane = newPane();
  card = resultsCardOf(pane, &holder);
  [pane showMeasured:@{@"ok": @YES,
                       @"title": @"Cold launch",
                       @"value": @"412 ms",
                       @"detail": @"dev.app"}];
  MVCheck(@"performance: the first result just measured comes in", [card.layer animationForKey:@"fade"] != nil, nil);
}

/// e16: a measure that restarted the app six times, and then the pane said nothing had moved for 282 s.
static void checkHeldSentence(void) {
  MVPerfPane *pane = newPane();
  NSTextField *sentence = [pane valueForKey:@"_sentence"];
  [pane show:@{@"sample": @{@"at": @1, @"fps": @0}}];
  [pane setValue:@(MVNowMs() - 282000) forKey:@"_heldSince"];
  [pane showMeasuring:@"launch 1 of 5"];
  [pane show:@{@"sample": @{@"at": @2, @"fps": @2}}];
  MVCheck(@"performance: while a measure runs the pane holds its sentence, and no figure of before stands as now", [sentence.stringValue isEqual:@"Readings wait while a measure runs"] && [[pane shownFor:@"fps"] isEqual:@"\u2013"], sentence.stringValue);
  [pane showMeasured:@{@"ok": @YES, @"title": @"Cold launch", @"value": @"412 ms"}];
  [pane show:@{@"sample": @{@"at": @3, @"fps": @0}}];
  MVCheck(@"performance: after it, how long nothing has moved is counted from then", [sentence.stringValue isEqual:@"Nothing moving"], sentence.stringValue);
}

/// e06 and w24: the capsule said 1 fps and the pane 3, the one the picture's rate and the other the app's.
static void checkRates(void) {
  MVPerfPane *pane = newPane();
  NSTextField *title = [[[pane valueForKey:@"_trends"] firstObject] valueForKey:@"title"];
  [pane show:@{@"sample": @{@"at": @1, @"fps": @33}}];
  MVCheck(@"performance: a rate the device counts is the app's, and says so", [title.stringValue isEqual:@"App frame rate"], title.stringValue);
  [pane setPictureRate:29];
  [pane show:@{@"sample": @{@"at": @2}}];
  MVCheck(@"performance: one it does not is the picture's, as the capsule's is", [title.stringValue isEqual:@"Picture frame rate"] && [[pane shownFor:@"fps"] isEqual:@"29 fps"], title.stringValue);
}

static void checkPair(void) {
  MVStatusLine *line = [MVStatusLine new];
  line.name = @"Phone";
  line.state = @"Live";
  MVCheck(@"pair: a window alone says nothing of one", ![line.stringValue containsString:@"To both"], line.stringValue);
  line.both = YES;
  line.pairing = @"To both";
  MVCheck(@"pair: a window says where a touch goes", [line.stringValue containsString:@"To both"], line.stringValue);
  line.failing = @"No Add here";
  MVCheck(@"pair: what failed stands in its place", [line.stringValue containsString:@"No Add here"] && ![line.stringValue containsString:@"To both"], line.stringValue);
  line.failing = nil;
  MVCheck(@"pair: a touch that lands clears it", [line.stringValue containsString:@"To both"], line.stringValue);
  MVPerfPane *pane = [[MVPerfPane alloc] initWithFrame:NSMakeRect(0, 0, 276, 600) target:NSNull.null];
  MVCheck(@"pair: a journey is measured from the pane the others are", MVFindControl(pane, @"journey") != nil, nil);
  NSRect room = NSMakeRect(0, 0, 1512, 900);
  NSPoint left = MVBesideOrigin(room, NSMakeSize(640, 800), YES), right = MVBesideOrigin(room, NSMakeSize(700, 600), NO);
  MVCheck(@"pair: two windows stand either side of the middle", left.x + 640 < 756 && right.x > 756, nil);
  MVCheck(@"pair: their tops are level", left.y + 800 == right.y + 600, nil);
  MVCheck(@"pair: a wide window stays on the screen", MVBesideOrigin(room, NSMakeSize(900, 600), YES).x == 0, nil);
}

/// A window that keeps what its controls ask for, and does none of it.
@interface MVAskedWindow : MVWindow
@property(nonatomic) NSMutableArray<NSString *> *asked;
@end

@implementation MVAskedWindow
- (void)perform:(NSString *)name {
  [self.asked addObject:name ?: @"nothing"];
}
@end

/// A click by the window's own events on each button of its bar, on each kind of device: not one is a call to what it does.
static void checkClicks(void) {
  NSArray *kinds = @[@[@"home", @"lock", @"volumeUp"], @[@"back", @"home", @"appSwitch", @"lock"]];
  for (NSArray<NSString *> *controls in kinds) {
    MVAskedWindow *window = [MVAskedWindow new];
    window.asked = [NSMutableArray array];
    window.behind = YES;
    [window configure:@{@"title": @"clicks",
                        @"look": @{@"controls": controls}}];
    // room for the whole toolbar, which folds into its own menu where it has none
    [window.nsWindow setContentSize:NSMakeSize(1000, 700)];
    [window.nsWindow displayIfNeeded];
    NSMutableArray<NSString *> *names = [NSMutableArray arrayWithArray:@[@"screenshot", @"record", @"recordFlow", @"hud"]];
    for (NSString *name in @[@"back", @"home", @"appSwitch", @"lock"])
      if ([controls containsObject:name]) [names addObject:name];
    [names addObject:@"inspector"];
    for (NSString *name in names) {
      [window pokeClick:name];
      for (NSEvent *e; (e = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:[NSDate dateWithTimeIntervalSinceNow:0.05] inMode:NSDefaultRunLoopMode dequeue:YES]);) [NSApp sendEvent:e];
    }
    MVCheck(@"clicks: every button of a bar does what its name says", [window.asked isEqual:names], [window.asked componentsJoinedByString:@" "]);
  }
}

/// More's items, fired by the menu itself, on a window of its own and on one in a room: no menu opens here, as one would on
/// a person's screen. What the room's window answers to is the hub, and no item may rest on that.
static void checkMenus(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  NSArray *controls = @[@"back", @"home", @"appSwitch", @"lock", @"rotateLeft", @"rotateRight", @"copy"];
  NSArray *names = @[@"rotateLeft", @"rotateRight", @"copy", @"zoomIn"];
  for (MVAskedWindow *window in @[[MVAskedWindow new], [[MVAskedWindow alloc] initInRoom:hub.room]]) {
    window.asked = [NSMutableArray array];
    window.behind = YES;
    [window configure:@{@"title": @"menus",
                        @"look": @{@"controls": controls}}];
    for (NSString *name in names) [window pokeMenu:name];
    MVCheck(@"menus: an item of More reaches its window, alone and in a room", [window.asked isEqual:names], [window.asked componentsJoinedByString:@" "]);
    [window.asked removeAllObjects];
    NSMenu *frame = [(MVView *)window.screenView deviceMenu];
    [frame performActionForItemAtIndex:[frame indexOfItemWithRepresentedObject:@"rotateLeft"]];
    MVCheck(@"menus: and so does an item of the frame's own menu", [window.asked isEqual:@[@"rotateLeft"]], [window.asked componentsJoinedByString:@" "]);
  }
}

static void checkHubChoice(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  NSDictionary *phone = @{@"id": @"p", @"serial": @"p", @"kind": @"phone", @"state": @"running", @"name": @"A phone"};
  NSDictionary *simulator = @{@"id": @"s", @"serial": @"s", @"kind": @"simulator", @"state": @"running", @"name": @"A simulator"};
  [hub show:@{@"devices": @[phone]}];
  MVCheck(@"hub: a phone streams only when a person chooses it", hub.chosen == nil, hub.chosen);
  [hub show:@{@"devices": @[phone, simulator]}];
  MVCheck(@"hub: a simulator already running may show at once", [hub.chosen isEqual:@"s"], hub.chosen);
}

static void checkGlass(void) {
  NSView *content = [NSView new];
  NSView *pane = MVGlass(content, 20, NO);
  BOOL system = NSClassFromString(@"NSGlassEffectView") != nil;
  // the glass or its stand-in, and what it holds is in it either way
  MVCheck(@"glass: a pane holds its content", system ? [pane valueForKey:@"contentView"] == content : content.superview == pane, nil);
}

static void checkMood(void) {
  NSDictionary *shape = @{(id)kIOSurfaceWidth: @64,
                          (id)kIOSurfaceHeight: @64,
                          (id)kIOSurfaceBytesPerElement: @4,
                          (id)kIOSurfacePixelFormat: @(kCVPixelFormatType_32BGRA)};
  IOSurfaceRef surface = IOSurfaceCreate((__bridge CFDictionaryRef)shape);
  IOSurfaceLock(surface, 0, NULL);
  memset(IOSurfaceGetBaseAddress(surface), 255, IOSurfaceGetAllocSize(surface));
  IOSurfaceUnlock(surface, 0, NULL);
  CGImageRef dark = MVPictureMood(surface, YES), light = MVPictureMood(surface, NO);
  MVCheck(@"backdrop: a picture gives a mood, light and dark", dark && light, nil);
  uint8_t px[2][4];
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  for (int i = 0; i < 2; i++) {
    CGContextRef c = CGBitmapContextCreate(px[i], 1, 1, 8, 4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
    CGContextDrawImage(c, CGRectMake(0, 0, 1, 1), i ? light : dark);
    CGContextRelease(c);
  }
  CGColorSpaceRelease(space);
  // a white screen must not lift a dark window to white: what floats over it has to stay readable
  MVCheck(@"backdrop: a white picture stays dim in dark, and light in light", px[0][0] < 160 && px[1][0] > 230, nil);
  if (dark) CGImageRelease(dark);
  if (light) CGImageRelease(light);
  CFRelease(surface);
}

/// One corner's colour of a mood, as its first byte in each channel.
static void moodCorner(CGImageRef mood, uint8_t px[4]) {
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef c = CGBitmapContextCreate(px, 1, 1, 8, 4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
  CGContextDrawImage(c, CGRectMake(0, 0, 1, 1), mood);
  CGContextRelease(c);
  CGColorSpaceRelease(space);
}

/// Red, as a stream carries it, in a kind of image of `lines` lines of colours.
static BOOL redMood(OSType format, size_t lines, NSString *name) {
  CVPixelBufferRef image = NULL;
  CVPixelBufferCreate(NULL, 64, 64, format, NULL, &image);
  CVPixelBufferLockBaseAddress(image, 0);
  memset(CVPixelBufferGetBaseAddressOfPlane(image, 0), 63, CVPixelBufferGetBytesPerRowOfPlane(image, 0) * 64);
  uint8_t *chroma = CVPixelBufferGetBaseAddressOfPlane(image, 1);
  for (size_t i = 0; i < CVPixelBufferGetBytesPerRowOfPlane(image, 1) * lines; i += 2) {
    chroma[i] = 102;
    chroma[i + 1] = 240;
  }
  CVPixelBufferUnlockBaseAddress(image, 0);
  CGImageRef mood = MVImageMood(image, NO);
  uint8_t px[4] = {0};
  if (mood) moodCorner(mood, px);
  BOOL red = mood && px[0] > px[1] + 40 && px[0] > px[2] + 40;
  MVCheck(name, red, [NSString stringWithFormat:@"%d %d %d", px[0], px[1], px[2]]);
  if (mood) CGImageRelease(mood);
  CVPixelBufferRelease(image);
  return red;
}

static void checkStreamMood(void) {
  redMood(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, 32, @"backdrop: a stream's own colours reach the window");
  redMood(kCVPixelFormatType_444YpCbCr8BiPlanarFullRange, 64, @"backdrop: an iPhone's 4:4:4 stream gives its colours too");
  CVPixelBufferRef ten = NULL;
  CVPixelBufferCreate(NULL, 64, 64, kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange, NULL, &ten);
  CGImageRef none = ten ? MVImageMood(ten, NO) : NULL;
  MVCheck(@"backdrop: a kind of image it cannot read leaves the window as it was", ten && !none, nil);
  if (none) CGImageRelease(none);
  CVPixelBufferRelease(ten);
}

static void checkGestures(void) {
  MVCheck(@"pinch: fingers spread with the magnification", near(MVPinchGap(100, 0.5, 400), 150), nil);
  MVCheck(@"pinch: never onto each other, nor off the screen", near(MVPinchGap(10, -0.9, 400), 8) && near(MVPinchGap(390, 0.5, 400), 400), nil);
  MVView *view = [MVView new];
  [view setMarkedText:@"´" selectedRange:NSMakeRange(1, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
  MVCheck(@"text: a dead key waits to be composed", view.hasMarkedText, nil);
  [view insertText:@"é" replacementRange:NSMakeRange(NSNotFound, 0)];
  MVCheck(@"text: a composed character clears what was waiting", !view.hasMarkedText, nil);
}

void MVCheckFrame(void) {
  checkTable();
  checkLayout();
  checkZoom();
  checkControls();
  checkGlass();
  checkLive();
  checkMeasures();
  checkFirstResult();
  checkHeldSentence();
  checkRates();
  checkPair();
  checkClicks();
  checkMenus();
  checkHubChoice();
  checkMood();
  checkStreamMood();
  checkGestures();
}
