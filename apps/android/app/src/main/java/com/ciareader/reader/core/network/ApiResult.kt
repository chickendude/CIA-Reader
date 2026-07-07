package com.ciareader.reader.core.network

import retrofit2.HttpException
import java.io.IOException

/** Generic result for data-layer calls the UI renders (success or message). */
sealed interface Outcome<out T> {
    data class Success<T>(val data: T) : Outcome<T>
    data class Failure(val message: String) : Outcome<Nothing>
}

/** Runs a network call, mapping transport/HTTP errors to a user-facing message. */
suspend fun <T> apiCall(block: suspend () -> T): Outcome<T> = try {
    Outcome.Success(block())
} catch (e: HttpException) {
    Outcome.Failure(httpMessage(e.code()))
} catch (_: IOException) {
    Outcome.Failure("Network error — check your connection and try again.")
}

fun httpMessage(code: Int): String = when (code) {
    401 -> "Please sign in again."
    403 -> "You don't have access to that."
    404 -> "Not found."
    429 -> "You're saving too fast — wait a bit and try again."
    in 500..599 -> "The server had a problem. Please try again."
    else -> "Something went wrong ($code)."
}
