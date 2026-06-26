package com.ciareader.reader.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ciareader.reader.ui.collection.CollectionDetailScreen
import com.ciareader.reader.ui.downloads.DownloadsScreen
import com.ciareader.reader.ui.library.LibraryScreen
import com.ciareader.reader.ui.reader.ReaderScreen
import com.ciareader.reader.ui.settings.SettingsScreen
import com.ciareader.reader.ui.stats.StatsScreen

object Routes {
    const val LIBRARY = "library"
    const val READER = "reader/{textId}?collectionId={collectionId}&atEnd={atEnd}&resume={resume}"
    const val COLLECTION = "collection/{collectionId}"
    const val SETTINGS = "settings"
    const val DOWNLOADS = "downloads"
    const val STATS = "stats"

    /** Reader for [textId]; [collectionId] (optional) gives the book context so
     *  Previous/Next move between chapters; [atEnd] opens the chapter at its last
     *  page (for going back to a prior chapter). [resume] is true only for opening
     *  a book/text from the library; chapter-to-chapter navigation starts fresh so
     *  old per-chapter page anchors do not override the current book position. */
    fun reader(
        textId: String,
        collectionId: String? = null,
        atEnd: Boolean = false,
        resume: Boolean = true,
    ): String {
        val params = buildList {
            collectionId?.let { add("collectionId=$it") }
            if (atEnd) add("atEnd=true")
            if (!resume) add("resume=false")
        }
        return "reader/$textId" + if (params.isEmpty()) "" else "?" + params.joinToString("&")
    }

    fun collection(collectionId: String) = "collection/$collectionId"
}

/** In-app navigation graph (shown once authenticated). */
@Composable
fun CiaReaderNavHost(onLogout: () -> Unit) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.LIBRARY) {
        composable(Routes.LIBRARY) {
            LibraryScreen(
                onOpenText = { textId -> navController.navigate(Routes.reader(textId)) },
                // Tapping a book opens the reader directly — the last-read chapter,
                // else the first. No chapter-select screen; chapters are switched
                // from the in-reader chapter dropdown (tap the title).
                onOpenCollection = { c ->
                    c.openTextId?.let { navController.navigate(Routes.reader(it, c.id)) }
                },
                // Fallback when an imported book has no resolvable first chapter:
                // open the collection detail so the user can pick a chapter.
                onOpenCollectionById = { id -> navController.navigate(Routes.collection(id)) },
                // After an EPUB import, open chapter 1 *with* the book id so the
                // reader loads sibling chapters (prev/next + the TOC).
                onOpenBookChapter = { textId, collectionId ->
                    navController.navigate(Routes.reader(textId, collectionId))
                },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onLogout = onLogout,
                onOpenDownloads = { navController.navigate(Routes.DOWNLOADS) },
                onOpenStats = { navController.navigate(Routes.STATS) },
            )
        }
        composable(Routes.DOWNLOADS) {
            DownloadsScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.STATS) {
            StatsScreen(onBack = { navController.popBackStack() })
        }
        composable(
            route = Routes.COLLECTION,
            arguments = listOf(navArgument("collectionId") { type = NavType.StringType }),
        ) { entry ->
            val collectionId = entry.arguments?.getString("collectionId")
            CollectionDetailScreen(
                onBack = { navController.popBackStack() },
                // Carry the book id into the reader so it can page across chapters.
                onOpenText = { textId -> navController.navigate(Routes.reader(textId, collectionId)) },
            )
        }
        composable(
            route = Routes.READER,
            arguments = listOf(
                navArgument("textId") { type = NavType.StringType },
                navArgument("collectionId") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
                navArgument("atEnd") {
                    type = NavType.BoolType
                    defaultValue = false
                },
                navArgument("resume") {
                    type = NavType.BoolType
                    defaultValue = true
                },
            ),
        ) { entry ->
            val collectionId = entry.arguments?.getString("collectionId")
            ReaderScreen(
                onBack = { navController.popBackStack() },
                // Replace the current reader rather than stacking chapters, so Back
                // exits the reader (to the book / library) instead of walking back
                // through every chapter you opened.
                onOpenChapterText = { textId, atEnd ->
                    // Each chapter is a distinct text and needs its own back-stack
                    // entry + ViewModel. launchSingleTop reused the entry, so the
                    // reader stayed stuck on the first chapter. popUpTo still keeps
                    // only one reader, so Back exits to the book/library.
                    navController.navigate(Routes.reader(textId, collectionId, atEnd, resume = false)) {
                        popUpTo(Routes.READER) { inclusive = true }
                    }
                },
            )
        }
    }
}
