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
    const val READER = "reader/{textId}"
    const val COLLECTION = "collection/{collectionId}"
    fun reader(textId: String) = "reader/$textId"
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
                onOpenCollection = { id -> navController.navigate(Routes.collection(id)) },
                onLogout = onLogout,
            )
        }
        composable(
            route = Routes.COLLECTION,
            arguments = listOf(navArgument("collectionId") { type = NavType.StringType }),
        ) {
            CollectionDetailScreen(
                onBack = { navController.popBackStack() },
                onOpenText = { textId -> navController.navigate(Routes.reader(textId)) },
            )
        }
        composable(
            route = Routes.READER,
            arguments = listOf(navArgument("textId") { type = NavType.StringType }),
        ) {
            ReaderScreen(
                onBack = { navController.popBackStack() },
            )
        }
    }
}
