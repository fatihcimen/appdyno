// Liquid Glass where the system has it, by name at run time: a viewer is compiled on first use by whatever SDK this
// Mac has, and one older than macOS 26 has no such class to compile against. Glass is for what floats over the device
// and nothing in it: what sits on a pane is a fill, as glass cannot sample glass.
#import "Window.h"

static const double kNearest = 12;
static const double kComesAndGoes = 0.18;

NSView *MVGlass(NSView *content, double radius, BOOL holdsControls) {
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
  // macOS 27: only what holds controls answers a touch. No tint: glass takes its colour from what stands behind it, and a tint
  // near opaque turns it solid there
  if (holdsControls && [pane respondsToSelector:NSSelectorFromString(@"setEffectIsInteractive:")]) [pane setValue:@YES forKey:@"effectIsInteractive"];
  pane.translatesAutoresizingMaskIntoConstraints = NO;
  return pane;
}

void MVShowPane(NSView *pane, BOOL shown) {
  if (!MVMoves()) {
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
