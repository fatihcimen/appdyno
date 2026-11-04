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
  checkGestures();
}
