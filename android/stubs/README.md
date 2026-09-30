Compile-time stubs for the handful of Android framework APIs `MainActivity` uses.
They are never packaged: the device supplies the real classes. Each stub keeps the
real type's kind (class / abstract class / interface) and exact signatures, since
the dex encodes both. Used because the official SDK (`android.jar`) is unavailable
in environments that cannot reach dl.google.com.
