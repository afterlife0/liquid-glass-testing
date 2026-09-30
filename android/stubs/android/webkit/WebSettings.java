package android.webkit;
public abstract class WebSettings {
  public abstract void setJavaScriptEnabled(boolean flag);
  public abstract void setDomStorageEnabled(boolean flag);
  public abstract void setAllowFileAccess(boolean allow);
  public abstract void setAllowContentAccess(boolean allow);
  public abstract void setMediaPlaybackRequiresUserGesture(boolean require);
}
