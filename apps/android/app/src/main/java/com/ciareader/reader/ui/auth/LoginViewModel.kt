package com.ciareader.reader.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.data.auth.AuthRepository
import com.ciareader.reader.data.auth.AuthResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The login/register toggle for the auth-entry screen. */
enum class AuthMode { LOGIN, REGISTER }

data class LoginUiState(
    val mode: AuthMode = AuthMode.LOGIN,
    val email: String = "",
    val password: String = "",
    val displayName: String = "",
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
    val magicLinkSent: Boolean = false,
) {
    val canSubmit: Boolean
        get() = !isSubmitting && email.isNotBlank() && password.isNotBlank()
}

/**
 * Backs [LoginScreen]: email+password login, registration (same screen, via
 * [AuthMode]), and passwordless magic-link requests.
 */
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onEmailChange(value: String) = _uiState.update { it.copy(email = value, errorMessage = null) }
    fun onPasswordChange(value: String) = _uiState.update { it.copy(password = value, errorMessage = null) }
    fun onDisplayNameChange(value: String) = _uiState.update { it.copy(displayName = value) }

    fun toggleMode() = _uiState.update {
        it.copy(
            mode = if (it.mode == AuthMode.LOGIN) AuthMode.REGISTER else AuthMode.LOGIN,
            errorMessage = null,
            magicLinkSent = false,
        )
    }

    fun submit() {
        val state = _uiState.value
        if (!state.canSubmit) return
        _uiState.update { it.copy(isSubmitting = true, errorMessage = null, magicLinkSent = false) }
        viewModelScope.launch {
            val result = when (state.mode) {
                AuthMode.LOGIN -> authRepository.login(state.email.trim(), state.password)
                AuthMode.REGISTER -> authRepository.register(
                    state.email.trim(),
                    state.password,
                    state.displayName.trim().ifBlank { null },
                )
            }
            // On success the isAuthenticated flow flips and the root recomposes
            // away from this screen; we only surface failures here.
            _uiState.update {
                it.copy(
                    isSubmitting = false,
                    errorMessage = (result as? AuthResult.Error)?.message,
                )
            }
        }
    }

    fun sendMagicLink() {
        val state = _uiState.value
        if (state.isSubmitting) return
        if (state.email.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Enter your email to get a sign-in link.") }
            return
        }
        _uiState.update { it.copy(isSubmitting = true, errorMessage = null, magicLinkSent = false) }
        viewModelScope.launch {
            val result = authRepository.requestMagicLink(state.email.trim())
            _uiState.update {
                it.copy(
                    isSubmitting = false,
                    errorMessage = (result as? AuthResult.Error)?.message,
                    magicLinkSent = result is AuthResult.Success,
                )
            }
        }
    }
}
