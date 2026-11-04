// A program run inside one simulator, for the pages of Settings: their links are private, and the simulator's own
// `openurl` is refused them. The one entitlement this needs is in SimOpen.plist, linked in as the section a simulator
// reads: a signature holding it is refused a start. Private API. Usage: SimOpen <link>
#import <Foundation/Foundation.h>
#import <objc/message.h>

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 2) return 2;
    id (*workspaceOf)(Class, SEL) = (void *)objc_msgSend;
    BOOL (*open)(id, SEL, NSURL *, NSDictionary *, NSError **) = (void *)objc_msgSend;
    id workspace = workspaceOf(NSClassFromString(@"LSApplicationWorkspace"), NSSelectorFromString(@"defaultWorkspace"));
    NSError *error = nil;
    SEL opens = NSSelectorFromString(@"openSensitiveURL:withOptions:error:");
    if (open(workspace, opens, [NSURL URLWithString:@(argv[1])], nil, &error)) return 0;
    fprintf(stderr, "%s\n", error.localizedDescription.UTF8String ?: "it did not open");
    return 1;
  }
}
