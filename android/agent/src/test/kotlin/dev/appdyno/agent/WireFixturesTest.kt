package dev.appdyno.agent

import android.graphics.Rect
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The protocol's canonical JSON, `packages/protocol/fixtures`, which the host's tests hold to its schemas. */
class WireFixturesTest {
    private fun fixture(name: String) = JSONObject(javaClass.classLoader!!.getResource("$name.json")!!.readText())

    private val requests = fixture("requests")
    private val results = fixture("results")
    private val errors = fixture("errors")

    private fun params(name: String) = requests.getJSONObject(name).getJSONObject("params")

    private fun result(name: String) = results.getJSONObject(name).getJSONObject("result")

    private fun same(expected: JSONObject, actual: JSONObject) = assertTrue("$actual\nis not\n$expected", expected.similar(actual))

    private fun JSONObject.text(key: String) = if (has(key)) getString(key) else null

    /** A capture of what a canonical tree says. */
    private fun capture(t: JSONObject): Capture {
        val ws = t.getJSONArray("windows")
        val windows = (0 until ws.length()).map { i ->
            val w = ws.getJSONObject(i)
            val b = w.getJSONArray("b")
            val bounds = Rect().apply {
                left = b.getInt(0)
                top = b.getInt(1)
                right = b.getInt(2)
                bottom = b.getInt(3)
            }
            CWindow(i, w.getInt("type"), w.text("pkg"), w.getInt("layer"), bounds, w.getBoolean("active"), w.getBoolean("focused"))
        }
        if (t.optBoolean("moving")) windows[0].offsetX = 40
        val ns = t.getJSONArray("nodes")
        val nodes = (0 until ns.length()).map { i ->
            val n = ns.getJSONObject(i)
            val b = n.getJSONArray("b")
            CNode(n.getInt("p"), n.getInt("w"), n.getString("c"), n.text("id"), n.text("t"), n.text("d"), n.text("h"), b.getInt(0), b.getInt(1), b.getInt(2), b.getInt(3), n.getInt("f"))
        }
        return Capture(windows, nodes, t.getBoolean("truncated"), t.getLong("elapsedMs"), DisplayInfo(1080, 2400, 420, 0))
    }

    @Test
    fun aTapAsTheHostSendsIt() {
        val p = params("act.tap")
        val a = Action.from(p.getJSONObject("action")) as Action.Tap
        assertEquals(100.5f, a.x)
        assertEquals(200f, a.y)
        val after = AfterRequest.from(p)
        assertEquals(200L, after.settle!!.quietMs)
        assertEquals(3_000L, after.settle!!.maxMs)
        assertEquals("none", after.read)
        assertEquals("abc", after.before)
    }

    @Test
    fun theOtherActionsAsTheHostSendsThem() {
        fun action(name: String) = Action.from(params(name).getJSONObject("action"))
        assertEquals(10f, (action("act.doubleTap") as Action.DoubleTap).x)
        assertEquals(800L, (action("act.longPress") as Action.LongPress).durationMs)
        val swipe = action("act.swipe") as Action.Swipe
        assertEquals(1f to 2f, swipe.from)
        assertEquals(3f to 4f, swipe.to)
        assertEquals(300L, swipe.durationMs)
        val gesture = action("act.gesture") as Action.Gesture
        assertEquals(listOf(2, 1), gesture.pointers.map { it.size })
        assertEquals(100L, gesture.pointers[0][1].t)
        assertEquals("enter", (action("act.key") as Action.Key).key)
        assertEquals(emptyList<String>(), (action("act.key") as Action.Key).modifiers)
        val shortcut = action("act.shortcut") as Action.Key
        assertEquals("a", shortcut.key)
        assertEquals(listOf("command", "shift"), shortcut.modifiers)
        assertNull(AfterRequest.from(params("act.doubleTap")).settle)
        assertEquals("tree", AfterRequest.from(params("act.longPress")).read)
    }

    @Test
    fun textAsTheHostSendsIt() {
        val plain = TextRequest.from(params("text.set"))
        assertEquals("merhaba dünya", plain.text)
        assertFalse(plain.replace)
        assertFalse(plain.submit)
        assertNull(plain.at)
        assertEquals(5_000L, plain.focusTimeoutMs)
        val at = TextRequest.from(params("text.set.at"))
        assertTrue(at.replace && at.submit)
        assertEquals(12.5f to 34f, at.at)
        assertEquals("tree", at.after.read)
    }

    @Test
    fun readsAsTheHostSendsThem() {
        val tree = TreeRequest.from(params("tree.get"))
        assertEquals(128, tree.maxDepth)
        assertEquals(5_000, tree.maxNodes)
        val jpeg = ShotRequest.from(params("screenshot"))
        assertFalse(jpeg.png)
        assertEquals(80, jpeg.quality)
        assertNull(jpeg.maxPx)
        assertEquals(1024, ShotRequest.from(params("screenshot.png")).maxPx)
        val wait = WaitRequest.from(params("wait"))
        assertNull(wait.since)
        assertEquals(300L, wait.minMs)
        assertEquals("abc", WaitRequest.from(params("wait.since")).since)
    }

    @Test
    fun theRequestsOfOneValueAsTheHostSendsThem() {
        assertEquals("a", OneValue.text(params("clipboard.set")))
        assertTrue(OneValue.off(params("animations.set")))
        assertEquals(1, OneValue.rotation(params("orientation.set")))
        assertEquals(60, OneValue.maxNodes(params("a11y.read")))
        assertEquals(7, OneValue.id(params("cancel")))
    }

    @Test
    fun aTouchAsTheHostSendsIt() {
        val two = TouchRequest.from(params("touch"))
        assertEquals(1, two.phase)
        assertEquals(0.5f, two.x)
        assertEquals(0.25f, two.y)
        assertEquals(0.75f, two.x2)
        assertEquals(0.125f, two.y2)
        val one = TouchRequest.from(params("touch.one"))
        assertEquals(0, one.phase)
        assertNull(one.x2)
        assertNull(one.y2)
    }

    @Test
    fun aHelloIsWhatTheHostTakes() {
        val d = DisplayInfo(1080, 2400, 420, 0)
        same(result("hello.android"), Results.hello("0.0.0", "15", 35, "Google Pixel 8", d, 1234))
    }

    @Test
    fun aTreeIsWhatTheHostTakes() {
        val tree = result("tree.android")
        same(tree, Results.tree(capture(tree)))
    }

    @Test
    fun aSettleATextAndAPictureAreWhatTheHostTakes() {
        val settled = result("act.settled").getJSONObject("settle")
        same(settled, Results.settle(SettleOutcome(true, 3, Unit, 240, 200), moving = false))
        val moving = result("act.moving").getJSONObject("settle")
        same(moving, Results.settle(SettleOutcome(false, 9, Unit, 3_000, 400), moving = true))
        same(result("text.verified"), Results.text(TextOutcome("setText", true, 40)))
        same(result("text.keys"), Results.text(TextOutcome("keys", null, 2_000)))
        same(result("screenshot.jpeg"), Results.shot(540, 1200, false, 4096))
        same(result("screenshot.png"), Results.shot(540, 1200, true, 8192))
    }

    @Test
    fun aWaitAndAnAccessibilityReadAreWhatTheHostTakes() {
        val changed = result("wait.changed")
        val tree = changed.getJSONObject("tree")
        same(changed, Results.wait(WaitOutcome("abc", true, 2, 160, Unit), tree))
        same(result("wait.same"), Results.wait(WaitOutcome("abc", false, 12, 1_000, null), null))
        val read = result("a11y.read")
        same(read.getJSONArray("clips").getJSONObject(0), Results.clip(3, 20, 4))
        val traversal = read.getJSONArray("traversal")
        same(traversal.getJSONObject(0), Results.traversal(1, 2, null))
        same(traversal.getJSONObject(1), Results.traversal(2, null, 1))
        same(traversal.getJSONObject(2), Results.traversal(5, null, null))
    }

    @Test
    fun anErrorIsWhatTheHostTakes() {
        for (name in errors.keys()) {
            val e = errors.getJSONObject(name)
            val data = e.getJSONObject("data")
            val reply = JSONObject(errorJson(7, AgentFailure(data.getString("code"), e.getString("message"), data.text("hint"))))
            assertEquals(7, reply.getInt("id"))
            same(e, reply.getJSONObject("error"))
        }
        same(errors.getJSONObject("unknownMethod"), JSONObject(errorJson(7, unknownMethod("nope"))).getJSONObject("error"))
    }
}
