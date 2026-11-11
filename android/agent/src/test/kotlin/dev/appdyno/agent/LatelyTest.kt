package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.ConcurrentLinkedQueue

class LatelyTest {
    @Test
    fun keepsTheLastOnesUsed() {
        val lately = Lately<Int>(2)
        lately["a"] = 1
        lately["b"] = 2
        assertEquals(1, lately["a"])
        lately["c"] = 3
        // b went, as a was read since
        assertNull(lately["b"])
        assertEquals(1, lately["a"])
        assertEquals(3, lately["c"])
    }

    @Test(timeout = 60_000)
    fun aGivenUpThreadBesideTheNewOneLeavesItWhole() {
        // the reads and writes of a given-up lane thread and of the new one, at once
        val lately = Lately<Int>(8)
        val failed = ConcurrentLinkedQueue<Throwable>()
        val threads = (0 until 4).map { t ->
            Thread {
                try {
                    repeat(200_000) { i ->
                        val key = ((i * 7 + t) % 16).toString()
                        if (i % 2 == 0) lately[key] = i else lately[key]
                    }
                } catch (e: Throwable) {
                    failed.add(e)
                }
            }.apply { isDaemon = true }
        }
        threads.forEach { it.start() }
        threads.forEach { it.join() }
        assertEquals(emptyList<Throwable>(), failed.toList())
        // still the last eight: every new one is found, and the ones before them are gone
        for (k in 'a'..'p') lately[k.toString()] = 0
        for (k in 'a'..'h') assertNull(k.toString(), lately[k.toString()])
        for (k in 'i'..'p') assertNotNull(k.toString(), lately[k.toString()])
    }
}
