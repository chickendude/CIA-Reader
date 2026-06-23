package com.ciareader.reader.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ciareader.reader.ui.collection.CollectionDetailScreen
import com.ciareader.reader.ui.library.LibraryScreen
import com.ciareader.reader.ui.reader.ReaderScreen

object Routes {
    const val LIBRARY = "library"
    const val READER = "reader/{textId}?collectionId={collectionId}&atEnd={atEnd}"
    const val COLLECTION = "collection/{collectionId}"

    /** Reader for [textId]; [collectionId] (optional) gives the book context so
     *  Previous/Next move between chapters; [atEnd] opens the chapter at its last
     *  page (for going back to a prior chapter). */
    fun reader(textId: String, collectionId: String? = null, atEnd: Boolean = false): String {
        val params = buildList {
            collectionId?.let { add("collectionId=$it") }
            if (atEnd) add("atEnd=true")
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
                onLogout = onLogout,
            )
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
                    navController.navigate(Routes.reader(textId, collectionId, atEnd)) {
                        popUpTo(Routes.READER) { inclusive = true }
                    }
                },
            )
        }
    }
}
