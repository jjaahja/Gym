package de.jjaahja.gym;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Eigene Plugins: Trainings in Health Connect speichern, Updates direkt aus der App
        registerPlugin(GymHealthPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(DevicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
