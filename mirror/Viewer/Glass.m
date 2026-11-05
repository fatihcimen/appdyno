// Liquid Glass where the system has it, by name at run time: a viewer is compiled on first use by whatever SDK this
// Mac has, and one older than macOS 26 has no such class to compile against. Glass is for what floats over the device
// and nothing in it: what sits on a pane is a fill, as glass cannot sample glass.
#import "Window.h"

static const double kNearest = 12;
static const double kComesAndGoes = 0.18;

NSView *MVGlass(NSView *content, double radius, NSColor *_Nullable tint) {
  Class glass = NSClassFromString(@"NSGlassEffectView");
  if (!glass) {
    NSVisualEffectView *pane = [NSVisualEffectView new];
    pane.material = NSVisualEffectMaterialHUDWindow;
    pane.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    pane.state = NSVisualEffectStateActive;
    pane.wantsLayer = YES;
    pane.layer.cornerRadius = radius;
    pane.layer.masksToBounds = YES;
    content.translatesAutoresizingMaskIntoConstraints = NO;
    [pane addSubview:content];
    [NSLayoutConstraint activateConstraints:@[
      [content.leadingAnchor constraintEqualToAnchor:pane.leadingAnchor],
      [content.trailingAnchor constraintEqualToAnchor:pane.trailingAnchor],
      [content.topAnchor constraintEqualToAnchor:pane.topAnchor],
      [content.bottomAnchor constraintEqualToAnchor:pane.bottomAnchor],
    ]];
    return pane;
  }
  NSView *pane = [glass new];
  [pane setValue:content forKey:@"contentView"];
  [pane setValue:@(radius) forKey:@"cornerRadius"];
  if (tint) [pane setValue:tint forKey:@"tintColor"];
  // macOS 27: a pane that holds controls answers a touch
  if ([pane respondsToSelector:NSSelectorFromString(@"setEffectIsInteractive:")]) [pane setValue:@YES forKey:@"effectIsInteractive"];
  pane.translatesAutoresizingMaskIntoConstraints = NO;
  return pane;
}

void MVShowPane(NSView *pane, BOOL shown) {
  if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
    pane.hidden = !shown;
    pane.alphaValue = 1;
    return;
  }
  if (shown && pane.hidden) pane.alphaValue = 0;
  if (shown) pane.hidden = NO;
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = kComesAndGoes;
        context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
        pane.animator.alphaValue = shown ? 1 : 0;
      }
      completionHandler:^{
        // shown again meanwhile: the later word stands
        if (shown || pane.alphaValue > 0) return;
        pane.hidden = YES;
        pane.alphaValue = 1;
      }];
}

NSView *MVGlassGroup(NSView *content) {
  Class group = NSClassFromString(@"NSGlassEffectContainerView");
  if (!group) return content;
  NSView *container = [group new];
  [container setValue:content forKey:@"contentView"];
  [container setValue:@(kNearest) forKey:@"spacing"];
  container.translatesAutoresizingMaskIntoConstraints = NO;
  return container;
}

/// A click on a window not in use is the click a person meant: a window opens in front with no keyboard, and without
/// this its first click on any control only made the window the one in use, with nothing to show for it.
@interface MVBarButton : NSButton
@end

@implementation MVBarButton
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}
@end

/// One button of a glass bar: a symbol and nothing else, its words for a person's pointer and for VoiceOver.
static NSButton *barButton(NSString *name, id target, SEL action) {
  NSImageSymbolConfiguration *quiet = [NSImageSymbolConfiguration configurationWithPointSize:15 weight:NSFontWeightRegular];
  NSButton *button = [MVBarButton buttonWithImage:[MVControlImage(name) imageWithSymbolConfiguration:quiet] target:target action:action];
  button.bordered = NO;
  button.identifier = name;
  button.toolTip = MVControlTitle(name);
  button.accessibilityLabel = MVControlTitle(name);
  button.contentTintColor = NSColor.labelColor;
  [button.widthAnchor constraintEqualToConstant:36].active = YES;
  [button.heightAnchor constraintEqualToConstant:36].active = YES;
  return button;
}

NSView *MVGlassBar(NSArray<NSArray<NSString *> *> *groups, id target, SEL action) {
  NSMutableArray<NSView *> *panes = [NSMutableArray array];
  for (NSArray<NSString *> *names in groups) {
    NSMutableArray *buttons = [NSMutableArray array];
    for (NSString *name in names) [buttons addObject:barButton(name, target, action)];
    NSStackView *row = [NSStackView stackViewWithViews:buttons];
    row.spacing = 0;
    row.edgeInsets = NSEdgeInsetsMake(2, 6, 2, 6);
    [panes addObject:MVGlass(row, 20, nil)];
  }
  NSStackView *all = [NSStackView stackViewWithViews:panes];
  all.spacing = 10;
  return MVGlassGroup(all);
}
