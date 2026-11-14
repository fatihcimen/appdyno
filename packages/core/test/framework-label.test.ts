import { describe, expect, it } from 'vitest';
import {
  frameworkOfElements,
  frameworkOfViews,
  type NativeView,
  type UiElement,
} from '../src/index.js';

type Spec = [cls: string, rect: [number, number, number, number], parent?: number];

const views = (specs: Spec[], more: Partial<NativeView>[] = []) => ({
  truncated: false,
  views: specs.map(([cls, [x, y, width, height], parent], i) => ({
    class: cls,
    rect: { x, y, width, height },
    ...(parent !== undefined && { parent }),
    ...more[i],
  })),
});

const PHONE: [number, number, number, number] = [0, 0, 402, 874];
const BODY: [number, number, number, number] = [0, 116, 402, 724];

// as the fixture's views read on an iOS 26.5 simulator, mangled as the runtime names them
const ROOT = '_TtGC7SwiftUI14_UIHostingViewGVS_15ModifiedContentVS_7AnyViewVS_12RootModifier__';
const STACK =
  '_TtGC7SwiftUI21UIKitPlatformViewHostGVS_42PlatformViewControllerRepresentableAdaptorVS_P10$1d374170828NavigationStackRepresentable__';
const PAGE =
  '_TtCGC7SwiftUI32NavigationStackHostingControllerVS_7AnyView_P10$1d374148c11HostingView';
const LIST =
  '_TtGC7SwiftUI21UIKitPlatformViewHostGVS_P10$1d3747c1817ListRepresentableGVS_28CollectionViewListDataSourceOs5Never_GOS_19SelectionManagerBoxS3____';
const TABLE_HOST =
  '_TtGC7SwiftUI21UIKitPlatformViewHostGVS_42PlatformViewControllerRepresentableAdaptorV7Fixture11UIKitScreen__';
const WEB_HOST =
  '_TtGC7SwiftUI21UIKitPlatformViewHostGVS_P10$1d374ce4432PlatformViewRepresentableAdaptorV7Fixture9WebScreen__';
const FLOATING = '_TtGC5UIKitP10$186ecd81022FloatingBarHostingViewVS_20FloatingBarContainer_';

/** A SwiftUI app's window down to a page of its navigation stack, then `inside` under that page. */
const swiftUI = (inside: Spec[]) =>
  views([
    ['UIWindow', PHONE],
    [ROOT, PHONE, 0],
    [STACK, PHONE, 1],
    ['UILayoutContainerView', PHONE, 2],
    [PAGE, PHONE, 3],
    ...inside,
  ]);

describe('the framework of a screen by its native views', () => {
  it('is UIKit or Android views where nothing else draws over the content', () => {
    const ios = views([
      ['UIWindow', PHONE],
      ['UILayoutContainerView', PHONE, 0],
      ['UITableView', BODY, 1],
      ['_UIFloatingBarContainerView', PHONE, 0],
      [FLOATING, PHONE, 3],
    ]);
    expect(frameworkOfViews(ios, 'ios')).toEqual({ name: 'UIKit' });
    const android = views([
      ['com.android.internal.policy.DecorView', [0, 0, 1080, 2400]],
      ['android.widget.LinearLayout', [0, 0, 1080, 2400], 0],
      ['androidx.recyclerview.widget.RecyclerView', [0, 200, 1080, 2200], 1],
    ]);
    expect(frameworkOfViews(android, 'android')).toEqual({ name: 'Android views' });
  });

  it('is SwiftUI under its hosting views, through the navigation stack and list it hosts in UIKit', () => {
    expect(frameworkOfViews(swiftUI([]), 'ios')).toEqual({ name: 'SwiftUI' });
    const list = swiftUI([
      [LIST, PHONE, 4],
      ['SwiftUI.UpdateCoalescingCollectionView', PHONE, 5],
    ]);
    expect(frameworkOfViews(list, 'ios')).toEqual({ name: 'SwiftUI' });
    const demangled = views([
      ['UIWindow', PHONE],
      [
        'SwiftUI._UIHostingView<SwiftUI.ModifiedContent<SwiftUI.AnyView, SwiftUI.RootModifier>>',
        PHONE,
        0,
      ],
      [
        'SwiftUI.UIKitPlatformViewHost<SwiftUI.PlatformViewControllerRepresentableAdaptor<SwiftUI.(unknown context at $1d374170828).NavigationStackRepresentable>>',
        PHONE,
        1,
      ],
    ]);
    expect(frameworkOfViews(demangled, 'ios')).toEqual({ name: 'SwiftUI' });
  });

  it('is UIKit inside SwiftUI where a representable the app wrote holds most of the content', () => {
    for (const host of [
      TABLE_HOST,
      'SwiftUI.UIKitPlatformViewHost<SwiftUI.PlatformViewControllerRepresentableAdaptor<Fixture.UIKitScreen>>',
      'SwiftUI.PlatformViewHost<SwiftUI.PlatformViewRepresentableAdaptor<Fixture.Chart>>',
    ]) {
      const tree = swiftUI([
        [host, BODY, 4],
        ['UITableView', BODY, 5],
      ]);
      expect(frameworkOfViews(tree, 'ios')).toEqual({ name: 'UIKit', inside: 'SwiftUI' });
    }
  });

  it('is SwiftUI again where the representable hosts SwiftUI, and UIKit where that hosts UIKit', () => {
    const again = swiftUI([
      [TABLE_HOST, BODY, 4],
      [ROOT, BODY, 5],
    ]);
    expect(frameworkOfViews(again, 'ios')).toEqual({ name: 'SwiftUI' });
    const deeper = swiftUI([
      [TABLE_HOST, BODY, 4],
      [ROOT, BODY, 5],
      [TABLE_HOST, BODY, 6],
      ['UITableView', BODY, 7],
    ]);
    expect(frameworkOfViews(deeper, 'ios')).toEqual({ name: 'UIKit', inside: 'SwiftUI' });
  });

  it('is UIKit where SwiftUI draws only a part of the screen', () => {
    const tree = views([
      ['UIWindow', PHONE],
      ['UITableView', PHONE, 0],
      ['UITableViewCell', [0, 100, 402, 80], 1],
      [ROOT, [0, 100, 402, 80], 2],
    ]);
    expect(frameworkOfViews(tree, 'ios')).toEqual({ name: 'UIKit' });
  });

  it('names a web view by the framework that holds it, past the island it sits in', () => {
    const ios = swiftUI([
      [WEB_HOST, BODY, 4],
      ['WKWebView', BODY, 5],
    ]);
    expect(frameworkOfViews(ios, 'ios')).toEqual({ name: 'web view', inside: 'SwiftUI' });
    const android = views([
      ['com.android.internal.policy.DecorView', [0, 0, 1080, 2400]],
      ['androidx.compose.ui.platform.ComposeView', [0, 0, 1080, 2400], 0],
      ['androidx.compose.ui.viewinterop.ViewFactoryHolder', [0, 200, 1080, 2200], 1],
      ['android.webkit.WebView', [0, 200, 1080, 2200], 2],
    ]);
    expect(frameworkOfViews(android, 'android')).toEqual({ name: 'web view', inside: 'Compose' });
  });

  it('is Flutter, React Native or Compose by the root its content hangs from, on either platform', () => {
    const cases: [string, 'ios' | 'android', string][] = [
      ['FlutterView', 'ios', 'Flutter'],
      ['io.flutter.embedding.android.FlutterView', 'android', 'Flutter'],
      ['RCTRootView', 'ios', 'React Native'],
      ['RCTSurfaceHostingProxyRootView', 'ios', 'React Native'],
      ['com.facebook.react.ReactRootView', 'android', 'React Native'],
      ['com.facebook.react.runtime.ReactSurfaceView', 'android', 'React Native'],
      ['androidx.compose.ui.platform.AndroidComposeView', 'android', 'Compose'],
    ];
    for (const [root, platform, name] of cases)
      expect(
        frameworkOfViews(
          views([
            ['Window', PHONE],
            [root, PHONE, 0],
          ]),
          platform,
        ),
      ).toEqual({
        name,
      });
  });

  it('takes a framework inside its own kind as that one, and an Android view inside Compose as an island', () => {
    const compose = views([
      ['com.android.internal.policy.DecorView', [0, 0, 1080, 2400]],
      ['androidx.compose.ui.platform.ComposeView', [0, 0, 1080, 2400], 0],
      ['androidx.compose.ui.platform.AndroidComposeView', [0, 0, 1080, 2400], 1],
    ]);
    expect(frameworkOfViews(compose, 'android')).toEqual({ name: 'Compose' });
    const map = views([
      ['com.android.internal.policy.DecorView', [0, 0, 1080, 2400]],
      ['androidx.compose.ui.platform.AndroidComposeView', [0, 0, 1080, 2400], 0],
      ['androidx.compose.ui.viewinterop.ViewFactoryHolder', [0, 300, 1080, 2100], 1],
      ['org.example.MapView', [0, 300, 1080, 2100], 2],
    ]);
    expect(frameworkOfViews(map, 'android')).toEqual({ name: 'Android views', inside: 'Compose' });
  });

  it('counts only what is drawn on the screen: not hidden, not clear, not scrolled past it', () => {
    const over = (more: Partial<NativeView>[], rect = PHONE) =>
      frameworkOfViews(
        views(
          [
            ['UIWindow', PHONE],
            ['UIView', PHONE, 0],
            ['FlutterView', rect, 1],
          ],
          more,
        ),
        'ios',
      );
    expect(over([{}, {}, {}])).toEqual({ name: 'Flutter' });
    expect(over([{}, {}, { hidden: true }])).toEqual({ name: 'UIKit' });
    expect(over([{}, {}, { alpha: 0 }])).toEqual({ name: 'UIKit' });
    expect(over([{}, { hidden: true }, {}])).toEqual({ name: 'UIKit' });
    expect(over([{}, {}, {}], [0, 600, 402, 2000])).toEqual({ name: 'UIKit' });
  });

  it('adds up the roots of one framework, side by side', () => {
    const tree = views([
      ['UIWindow', PHONE],
      ['WKWebView', [0, 0, 201, 874], 0],
      ['WKWebView', [201, 0, 201, 874], 0],
    ]);
    expect(frameworkOfViews(tree, 'ios')).toEqual({ name: 'web view' });
  });

  it('takes the framework the device gave, and none from no views', () => {
    const tree = { ...views([['UIWindow', PHONE]]), framework: { name: 'Flutter' as const } };
    expect(frameworkOfViews(tree, 'ios')).toEqual({ name: 'Flutter' });
    expect(frameworkOfViews(views([]), 'android')).toBeUndefined();
  });

  it('reads a parent out of the list, or a loop of parents, as a view not drawn', () => {
    const tree = views([
      ['UIWindow', PHONE],
      ['FlutterView', PHONE, 7],
      ['WKWebView', PHONE, 3],
      ['WKWebView', PHONE, 2],
    ]);
    expect(frameworkOfViews(tree, 'ios')).toEqual({ name: 'UIKit' });
  });
});

describe('the framework of a screen by its accessibility tree', () => {
  const elements = (specs: Spec[], hidden: number[] = []): UiElement[] =>
    specs.map(([type, [x, y, width, height], parent], i) => ({
      type,
      rect: { x, y, width, height },
      ...(parent !== undefined && { parent }),
      ...(hidden.includes(i) && { visible: false }),
    }));

  it('is a web view where one covers most of it, on either platform', () => {
    expect(
      frameworkOfElements(
        elements([
          ['Application', PHONE],
          ['WebView', [0, 100, 402, 700], 0],
        ]),
      ),
    ).toEqual({ name: 'web view' });
    expect(
      frameworkOfElements(
        elements([
          ['android.widget.FrameLayout', [0, 0, 1080, 2400]],
          ['android.webkit.WebView', [0, 200, 1080, 2000], 0],
        ]),
      ),
    ).toEqual({ name: 'web view' });
  });

  it('is Compose where its view gives its class, and not known where no class tells', () => {
    expect(
      frameworkOfElements(
        elements([
          ['android.widget.FrameLayout', [0, 0, 1080, 2400]],
          ['androidx.compose.ui.platform.ComposeView', [0, 0, 1080, 2400], 0],
        ]),
      ),
    ).toEqual({ name: 'Compose' });
    const plain = elements([
      ['Application', PHONE],
      ['Other', PHONE, 0],
      ['Button', [20, 400, 350, 44], 1],
    ]);
    expect(frameworkOfElements(plain)).toBeUndefined();
  });

  it('leaves out what is not visible', () => {
    const tree = elements(
      [
        ['Application', PHONE],
        ['WebView', PHONE, 0],
      ],
      [1],
    );
    expect(frameworkOfElements(tree)).toBeUndefined();
  });
});
