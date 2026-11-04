package dev.appdyno.fixture

/** Stalls once for 1 s as its rows come in: what a scroll's frozen frames must read. */
class StallListActivity : ListActivity() {
    override val listId = R.id.list_stall
    private var stalled = false

    override fun onRow(position: Int) {
        if (position == 20 && !stalled) {
            stalled = true
            Thread.sleep(1_000)
        }
    }
}
