package com.ciareader.reader.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ciareader.reader.ui.library.LibraryScreen
import com.ciareader.reader.ui.reader.ReaderStubScreen

object Routes {
    const val LIBRARY = "library"
    const val READER = "reader/{textId}"
    fun reader(textId: String) = "reader/$textId"
}

/** In-app navigation graph (shown once authenticated). */
@Composable
fun CiaReaderNavHost(onLogout: () -> Unit) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.LIBRARY) {
        composable(Routes.LIBRARY) {
            LibraryScreen(
                onOpenText = { textId -> navController.navigate(Routes.reader(textId)) },
                onLogout = onLogout,
            )
        }
        composable(
            route = Routes.READER,
            arguments = listOf(navArgument("textId") { type = NavType.StringType }),
        ) { backStackEntry ->
            ReaderStubScreen(
                textId = backStackEntry.arguments?.getString("textId").orEmpty(),
                onBack = { navController.popBackStack() },
            )
        }
    }
}
