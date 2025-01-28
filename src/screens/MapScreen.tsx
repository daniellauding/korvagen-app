import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet, useColorScheme, Animated, TouchableOpacity, Dimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Map } from '../components/Map';
import { supabase } from '../lib/supabase';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '../types/navigation';
import { Database } from '../lib/database.types';
import { YStack, XStack, Card, Input, Text, Sheet } from 'tamagui';
import * as Location from 'expo-location';
import { Feather } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { useRoutes } from '../hooks/useRoutes';
import type { Route as RouteType, WaypointData } from '../hooks/useRoutes';
import { RoutePreviewCard } from '../components/RoutePreviewCard';
import { Region } from 'react-native-maps';
import { RouteList } from '../components/RouteList';
import { PanGestureHandler, State, PanGestureHandlerGestureEvent, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

type SnapPoints = {
  collapsed: number;
  mid: number;
  expanded: number;
};

type GestureContext = {
  startY: number;
  offsetY: number;
};

type PinData = {
  lat: number;
  lng: number;
  title?: string;
  description?: string;
};

type RouteMetadata = {
  waypoints?: WaypointData[];
  pins?: PinData[];
  options?: {
    reverse: boolean;
    closeLoop: boolean;
    doubleBack: boolean;
  };
  coordinates?: any[];
};

type Route = Database['public']['Tables']['routes']['Row'] & {
  creator: {
    full_name: string;
  } | null;
  metadata: RouteMetadata;
  waypoint_details: WaypointData[];
  reviews?: { 
    id: string;
    rating: number;
    content: string;
    difficulty: string;
    visited_at: string;
    created_at: string;
    images: { url: string; description?: string }[];
    user: { id: string; full_name: string; };
  }[];
};

const styles = StyleSheet.create({
  searchContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  previewContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    paddingBottom: 0,
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  handleContainer: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  routeListContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  contentContainer: {
    flex: 1,
  },
});

export function MapScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [routes, setRoutes] = useState<RouteType[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteType | null>(null);
  const { fetchRoutes } = useRoutes();
  const colorScheme = useColorScheme();
  const backgroundColor = colorScheme === 'dark' ? '#1A1A1A' : '#FFFFFF';
  const handleColor = colorScheme === 'dark' ? '#666' : '#CCC';
  const iconColor = colorScheme === 'dark' ? 'white' : 'black';
  const searchInputRef = useRef<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Location.LocationGeocodedAddress[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  // Memoize initial region
  const initialRegion = useMemo(() => ({
    latitude: 55.7047,
    longitude: 13.191,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  }), []);

  const [region, setRegion] = useState(initialRegion);
  const { height: screenHeight } = Dimensions.get('window');
  const snapPoints = {
    collapsed: screenHeight * 0.8,  // Start at 80% hidden
    mid: screenHeight * 0.5,        // 50% of screen
    expanded: screenHeight * 0.1     // Only 10% hidden from top
  };
  const [currentSnapPoint, setCurrentSnapPoint] = useState(snapPoints.collapsed);
  const translateY = useRef(new Animated.Value(snapPoints.collapsed)).current;
  const lastGesture = useRef(snapPoints.collapsed);
  const scrollOffset = useRef(0);
  const isDragging = useRef(false);

  const handleMarkerPress = useCallback((route: RouteType) => {
    setSelectedRoute(route);
    // Hide bottom sheet when showing preview card
    translateY.setValue(snapPoints.collapsed);
  }, [snapPoints.collapsed]);

  const handleMapPress = useCallback(() => {
    if (selectedRoute) {
      setSelectedRoute(null);
      // Show bottom sheet in collapsed state when hiding preview card
      translateY.setValue(snapPoints.collapsed);
    }
  }, [selectedRoute, snapPoints.collapsed]);

  // Memoize getAllWaypoints to prevent recreation
  const getAllWaypoints = useMemo(() => {
    return routes.map(route => {
      const waypointsData = (route.waypoint_details || route.metadata?.waypoints || []) as WaypointData[];
      if (waypointsData.length === 0) return null;
      
      const firstWaypoint = waypointsData[0];
      return {
        latitude: firstWaypoint.lat,
        longitude: firstWaypoint.lng,
        onPress: () => handleMarkerPress(route),
      };
    }).filter((wp): wp is NonNullable<typeof wp> => wp !== null);
  }, [routes, handleMarkerPress]);

  // Memoize getMapRegion to prevent recreation
  const getMapRegion = useMemo(() => {
    if (routes.length === 0) return null;
    
    const allWaypoints = routes.flatMap(route => 
      (route.waypoint_details || route.metadata?.waypoints || []) as WaypointData[]
    );
    
    if (allWaypoints.length === 0) return null;
    
    const latitudes = allWaypoints.map(wp => wp.lat);
    const longitudes = allWaypoints.map(wp => wp.lng);
    
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    
    const latPadding = (maxLat - minLat) * 0.1;
    const lngPadding = (maxLng - minLng) * 0.1;
    
    const minDelta = 0.01;
    const latDelta = Math.max((maxLat - minLat) + latPadding, minDelta);
    const lngDelta = Math.max((maxLng - minLng) + lngPadding, minDelta);

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    };
  }, [routes]);

  // Update region only when getMapRegion changes
  useEffect(() => {
    const newRegion = getMapRegion;
    if (newRegion) {
      setRegion(newRegion);
    }
  }, [getMapRegion]);

  // Optimize loadRoutes to prevent unnecessary re-renders
  const loadRoutes = useCallback(async () => {
    const data = await fetchRoutes();
    setRoutes(data);
  }, [fetchRoutes]);

  // Only run effect once on mount
  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        setRegion(prev => ({
          ...prev,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        }));
      }
      setIsMapReady(true);
    })();
  }, []);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    // Set new timeout for debounced search
    const timeout = setTimeout(async () => {
      try {
        // Try with city/country first
        let results = await Location.geocodeAsync(query);
        
        // If no results, try with more specific search
        if (results.length === 0) {
          // Add country/city to make search more specific
          const searchTerms = [
            `${query}, Sweden`,
            `${query}, Gothenburg`,
            `${query}, Stockholm`,
            `${query}, Malmö`,
            query // Original query as fallback
          ];

          for (const term of searchTerms) {
            results = await Location.geocodeAsync(term);
            if (results.length > 0) break;
          }
        }

        if (results.length > 0) {
          const addresses = await Promise.all(
            results.map(async result => {
              const address = await Location.reverseGeocodeAsync({
                latitude: result.latitude,
                longitude: result.longitude,
              });
              return {
                ...address[0],
                coords: {
                  latitude: result.latitude,
                  longitude: result.longitude,
                }
              };
            })
          );

          // Filter out duplicates and null values
          const uniqueAddresses = addresses.filter((addr, index, self) => 
            addr && addr.coords &&
            index === self.findIndex(a => 
              a.coords?.latitude === addr.coords?.latitude && 
              a.coords?.longitude === addr.coords?.longitude
            )
          );

          setSearchResults(uniqueAddresses);
          setShowSearchResults(true);
        }
      } catch (err) {
        console.error('Geocoding error:', err);
      }
    }, 300); // Reduced delay to 300ms for more responsive feel

    setSearchTimeout(timeout);
  };

  const handleLocationSelect = (result: (Location.LocationGeocodedAddress & { coords?: { latitude: number; longitude: number } })) => {
    if (result.coords) {
      setRegion({
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      setSearchQuery(`${result.street || ''} ${result.city || ''} ${result.country || ''}`.trim());
      setShowSearchResults(false);
    }
  };

  const handleLocateMe = async () => {
    try {
      const location = await Location.getCurrentPositionAsync({});
      setRegion(prev => ({
        ...prev,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }));
    } catch (err) {
      console.error('Error getting location:', err);
    }
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTimeout]);

  const snapTo = useCallback((point: number) => {
    Animated.spring(translateY, {
      toValue: point,
      useNativeDriver: true,
      tension: 65,
      friction: 12
    }).start();
    setCurrentSnapPoint(point);
  }, [translateY]);

  const onGestureEvent = useCallback(
    (event: PanGestureHandlerGestureEvent) => {
      isDragging.current = true;
      const { translationY } = event.nativeEvent;
      const newTranslateY = lastGesture.current + translationY;
      
      // Constrain the sheet movement
      const maxTranslate = snapPoints.collapsed;  // Most hidden
      const minTranslate = snapPoints.expanded;   // Most visible
      const constrainedTranslate = Math.max(minTranslate, Math.min(maxTranslate, newTranslateY));
      
      translateY.setValue(constrainedTranslate);
    },
    [snapPoints]
  );

  const onHandleStateChange = useCallback(
    (event: PanGestureHandlerStateChangeEvent) => {
      if (event.nativeEvent.state === State.END) {
        isDragging.current = false;
        const { translationY, velocityY } = event.nativeEvent;
        const currentPosition = lastGesture.current + translationY;
        lastGesture.current = currentPosition;

        // Determine which snap point to go to based on position and velocity
        let targetSnapPoint;
        if (velocityY < -500) {
          // Fast upward swipe - go to expanded
          targetSnapPoint = snapPoints.expanded;
        } else if (velocityY > 500) {
          // Fast downward swipe - go to collapsed
          targetSnapPoint = snapPoints.collapsed;
        } else {
          // Based on position
          const positions = [snapPoints.collapsed, snapPoints.mid, snapPoints.expanded];
          const currentOffset = currentPosition;
          targetSnapPoint = positions.reduce((prev, curr) => 
            Math.abs(curr - currentOffset) < Math.abs(prev - currentOffset) ? curr : prev
          );
        }

        snapTo(targetSnapPoint);
      }
    },
    [snapPoints, snapTo]
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isDragging.current) return;
    
    const { contentOffset } = event.nativeEvent;
    scrollOffset.current = contentOffset.y;

    // If user is scrolling and sheet is not expanded, expand it
    if (contentOffset.y > 0 && currentSnapPoint === snapPoints.collapsed) {
      snapTo(snapPoints.mid);
    }

    // If user scrolls to top and sheet is expanded, collapse it
    if (contentOffset.y === 0 && currentSnapPoint !== snapPoints.collapsed) {
      snapTo(snapPoints.collapsed);
    }
  }, [currentSnapPoint, snapPoints, snapTo]);

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <Map
          key={`map-${routes.length}`}
          waypoints={getAllWaypoints}
          region={region}
          onPress={handleMapPress}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Search bar overlay */}
        <SafeAreaView style={[styles.searchContainer]} edges={['top']}>
          <XStack padding="$2" gap="$2">
            <Input
              ref={searchInputRef}
              flex={1}
              value={searchQuery}
              onChangeText={handleSearch}
              placeholder="Search location..."
              backgroundColor="$background"
              borderWidth={1}
              borderColor="$borderColor"
              borderRadius="$2"
              height="$10"
              paddingLeft="$3"
              fontSize="$2"
            />
            <XStack
              backgroundColor="$background"
              borderRadius="$2"
              width="$10"
              height="$10"
              alignItems="center"
              justifyContent="center"
              borderWidth={1}
              borderColor="$borderColor"
              onPress={handleLocateMe}
              pressStyle={{ opacity: 0.7 }}
            >
              <Feather name="navigation" size={20} color={iconColor} />
            </XStack>
          </XStack>

          {showSearchResults && searchResults.length > 0 && (
            <Card
              elevate
              bordered
              backgroundColor="$background"
              margin="$2"
              marginTop={0}
            >
              <YStack padding="$2">
                {searchResults.map((result, index) => (
                  <XStack
                    key={index}
                    padding="$3"
                    pressStyle={{ opacity: 0.7 }}
                    onPress={() => handleLocationSelect(result)}
                  >
                    <Feather name="map-pin" size={16} marginRight="$2" />
                    <YStack>
                      <Text>
                        {[result.street, result.city, result.country]
                          .filter(Boolean)
                          .join(', ')}
                      </Text>
                    </YStack>
                  </XStack>
                ))}
              </YStack>
            </Card>
          )}
        </SafeAreaView>

        {/* Bottom sheet - hide when preview card is shown */}
        {!selectedRoute && (
          <PanGestureHandler
            onGestureEvent={onGestureEvent}
            onHandlerStateChange={onHandleStateChange}
          >
            <Animated.View
              style={[
                styles.bottomSheet,
                {
                  height: screenHeight,
                  backgroundColor,
                  transform: [{ translateY }]
                }
              ]}
            >
              <View style={styles.handleContainer}>
                <View style={[styles.handle, { backgroundColor: handleColor }]} />
              </View>
              <View style={styles.routeListContainer}>
                <RouteList
                  routes={routes}
                  onRefresh={loadRoutes}
                  onScroll={handleScroll}
                />
              </View>
            </Animated.View>
          </PanGestureHandler>
        )}

        {/* Route preview card */}
        {selectedRoute && (
          <RoutePreviewCard
            route={selectedRoute}
            showMap={false}
            onPress={() => setSelectedRoute(null)}
          />
        )}
      </View>
    </Screen>
  );
} 