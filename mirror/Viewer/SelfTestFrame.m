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
  MVFrameLayout upright = MVLayOutFrame(spec, tall, 0);
  MVCheck(@"frame: the screen sits in the middle of its body", near(upright.screen.origin.x, (upright.body.width - tall.width) / 2) && near(upright.screen.origin.y, (upright.body.height - tall.height) / 2), nil);
  MVCheck(@"frame: at one point a point it scales by one", near(upright.unit, 1), nil);
  MVCheck(@"frame: the body's corners wrap the screen's", upright.outer > upright.radius, nil);
  MVFrameLayout doubled = MVLayOutFrame(spec, CGSizeMake(804, 1748), 0);
  MVCheck(@"frame: it scales with its picture", near(doubled.body.width, upright.body.width * 2), nil);
  CGRect up = MVFrameKeyRect(spec, upright, spec.keys[1], 0), side = MVFrameKeyRect(spec, upright, spec.keys[3], 0);
  MVCheck(@"frame: keys stand proud of the body, left and right", up.origin.x < 0 && CGRectGetMaxX(side) > upright.body.width, nil);
  MVFrameLayout turned = MVLayOutFrame(spec, CGSizeMake(874, 402), 1);
  CGRect key = MVFrameKeyRect(spec, turned, spec.keys[1], 1);
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
      shortcuts++;
      [seen addObject:[NSString stringWithFormat:@"%@ %lu", item.keyEquivalent, (unsigned long)item.keyEquivalentModifierMask]];
    }
  }
  MVCheck(@"menu: no two controls share a shortcut", seen.count == shortcuts, nil);
  MVCheck(@"menu: every control has its symbol", MVControlImage(@"home") && MVControlImage(@"rotateLeft") && MVControlImage(@"controlCenter"), nil);
}

static void checkLive(void) {
  MVCheck(@"hud: a low rate with every frame on time is no fault", MVFramesState(@{@"fps": @20, @"framesDrawn": @20, @"jankyFrames": @0}) == MVLiveGood, nil);
  MVCheck(@"hud: a rate is judged by what came late", MVFramesState(@{@"framesDrawn": @20, @"jankyFrames": @4}) == MVLiveWarning && MVFramesState(@{@"framesDrawn": @12, @"jankyFrames": @10}) == MVLiveCritical, nil);
  MVCheck(@"hud: with no count of late frames there is no verdict", MVFramesState(@{@"fps": @12}) == MVLiveNeutral, nil);
  MVCheck(@"hud: one frozen frame is poor", MVStateOf(@"frozenFrames", 1) == MVLiveCritical && MVStateOf(@"frozenFrames", 0) == MVLiveGood, nil);
  MVCheck(@"hud: memory has no threshold to be judged by", MVStateOf(@"memoryMb", 4000) == MVLiveNeutral, nil);
  MVHud *hud = [[MVHud alloc] initWithFrame:NSMakeRect(0, 0, 180, 600)];
  [hud show:@{@"sample": @{@"at": @1, @"fps": @0, @"absent": @{@"cpuPercent": @"cannot measure CPU"}}, @"noise": @[@"mirrored"]}];
  MVCheck(@"hud: a device that counted no frames shows a still screen, no fault", [[hud shownFor:@"fps"] isEqual:@"Still"], [hud shownFor:@"fps"]);
  [hud setPictureRate:0];
  [hud show:@{@"sample": @{@"at": @2}}];
  MVCheck(@"hud: a still picture is still, and no fault", [[hud shownFor:@"fps"] isEqual:@"Still"], [hud shownFor:@"fps"]);
  [hud setPictureRate:58];
  [hud show:@{@"sample": @{@"at": @3}}];
  MVCheck(@"hud: with no count from the device, the picture's own rate", [[hud shownFor:@"fps"] isEqual:@"58 fps"], [hud shownFor:@"fps"]);
  [hud show:@{@"sample": @{@"at": @4, @"fps": @30}}];
  MVCheck(@"hud: a device's own count comes first", [[hud shownFor:@"fps"] isEqual:@"30 fps"], [hud shownFor:@"fps"]);
  [hud show:@{@"sample": @{@"at": @5, @"absent": @{@"cpuPercent": @"cannot measure CPU"}}}];
  MVCheck(@"hud: a measure a device cannot give is a dash, never 0", [[hud shownFor:@"cpuPercent"] isEqual:@"\u2013"], [hud shownFor:@"cpuPercent"]);
}

static void checkGlass(void) {
  NSView *content = [NSView new];
  NSView *pane = MVGlass(content, 20, nil);
  BOOL system = NSClassFromString(@"NSGlassEffectView") != nil;
  // the glass or its stand-in, and what it holds is in it either way
  MVCheck(@"glass: a pane holds its content", system ? [pane valueForKey:@"contentView"] == content : content.superview == pane, nil);
  NSView *bar = MVGlassBar(@[@[@"home"], @[@"record"]], pane, @selector(description));
  MVCheck(@"glass: a bar's button is found however deep it sits", MVFindControl(bar, @"record") != nil && MVFindControl(bar, @"lock") == nil, nil);
  MVCheck(@"glass: each button says what it does", [MVFindControl(bar, @"home").accessibilityLabel isEqual:@"Home"], nil);
}

static void checkMood(void) {
  NSDictionary *shape = @{(id)kIOSurfaceWidth: @64, (id)kIOSurfaceHeight: @64, (id)kIOSurfaceBytesPerElement: @4, (id)kIOSurfacePixelFormat: @(kCVPixelFormatType_32BGRA)};
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
  checkMood();
  checkGestures();
}
