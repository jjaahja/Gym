package de.jjaahja.gym;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Eigenes Plugin: Trainings in Health Connect speichern
        registerPlugin(GymHealthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
