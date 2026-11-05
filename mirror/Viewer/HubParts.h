// The hub's parts, for the files it is split across.
#import "Place.h"
#import "Window.h"

NS_ASSUME_NONNULL_BEGIN

extern NSString *const MVFoldKey;
extern NSString *const MVPlaceKey;

/// What a device is, as the sidebar says it, and the bar over it.
MVRow *MVDeviceRow(NSDictionary *device);
NSString *MVDeviceSymbol(NSDictionary *device);
/// A simulator's name, and the system it holds, which it carries in brackets.
NSArray<NSString *> *MVNamedParts(NSString *name);

@interface MVHub () {
  MVOffscreenWindow *_window;
  MVList *_list;
  NSSearchField *_search;
  NSDictionary *_shown;
  NSArray<NSDictionary *> *_devices;
  NSDictionary *_choices;
  BOOL _unfolded;
  NSView *_room;
  NSTextField *_name, *_about;
  NSButton *_start, *_new, *_again;
  MVInk *_mark;
  NSString *_held;
  NSStackView *_column;
  NSString *_chosen;
  MVNewDevice *_asking;
  MVToolbar *_bare;
  NSDictionary *_left;
  NSMutableArray<MVPlace *> *_places;
  NSView *_placeShown;
  NSString *_placeKey;
  BOOL _inspectorWasOpen;
  NSDictionary *_lastDevice;
  MVClientsPane *_clients;
  MVHelpPane *_help;
  MVConnectPane *_connect;
  MVToolsPane *_tools;
  MVPlace *_connectPlace;
  BOOL _placeByItself;
  NSString *_opening;
  NSView *_note;
  NSSplitViewItem *_sidebarItem;
  BOOL _sidebarGaveWay;
  NSSet<NSString *> *_seen;
  NSDictionary<NSString *, NSString *> *_seenNames;
}
- (void)showDevice:(nullable NSDictionary *)device;
- (void)ask:(NSString *)kind;
@end

NS_ASSUME_NONNULL_END
