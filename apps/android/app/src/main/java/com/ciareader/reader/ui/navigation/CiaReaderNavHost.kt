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
    const val READER = "reader/{textId}?collectionId={collectionId}"
    const val COLLECTION = "collection/{collectionId}"

    /** Reader for [textId]; [collectionId] (optional) gives the reader the
     *  book context so Previous/Next move between the book's chapters. */
    fun reader(textId: String, collectionId: String? = null) =
        "reader/$textId" + (collectionId?.let { "?collectionId=$it" }.orEmpty())

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
                // Open a book straight to where you left off (or its first chapter);
                // fall back to the chapter list only for an empty book.
                onOpenCollection = { c ->
                    val open = c.openTextId
                    if (open != null) {
                        navController.navigate(Routes.reader(open, c.id))
                    } else {
                        navController.navigate(Routes.collection(c.id))
                    }
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
            ),
        ) { entry ->
            val collectionId = entry.arguments?.getString("collectionId")
            ReaderScreen(
                onBack = { navController.popBackStack() },
                // Replace the current reader rather than stacking chapters, so Back
                // exits the reader (to the book / library) instead of walking back
                // through every chapter you opened.
                onOpenChapterText = { textId ->
                    navController.navigate(Routes.reader(textId, collectionId)) {
                        popUpTo(Routes.READER) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }
    }
}
