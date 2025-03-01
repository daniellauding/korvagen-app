import React, { useState, useEffect, useRef } from 'react';
import { View, ScrollView, Image, Alert, useColorScheme, Dimensions, TouchableOpacity, Platform } from 'react-native';
import { YStack, Form, Input, TextArea, XStack, Card, Separator, Group } from 'tamagui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Database } from '../lib/database.types';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NavigationProp } from '../types/navigation';
import { Map, Waypoint, Screen, Button, Text, Header, FormField, Chip } from '../components';
import * as Location from 'expo-location';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Region } from 'react-native-maps';
import { decode } from 'base64-arraybuffer';
import { useLocation } from '../context/LocationContext';
import { AppAnalytics } from '../utils/analytics';
import { MediaCarousel } from '../components/MediaCarousel';
import { MediaItem, Exercise, WaypointData, MediaUrl, RouteData } from '../types/route';

type DifficultyLevel = Database['public']['Enums']['difficulty_level'];
type SpotType = Database['public']['Enums']['spot_type'];
type SpotVisibility = Database['public']['Enums']['spot_visibility'];
type Category = Database['public']['Enums']['spot_category'];

const DIFFICULTY_LEVELS: DifficultyLevel[] = ['beginner', 'intermediate', 'advanced'];
const SPOT_TYPES: SpotType[] = ['urban', 'rural', 'highway', 'residential'];
const VISIBILITY_OPTIONS: SpotVisibility[] = ['public', 'private', 'school_only'];
const CATEGORIES: Category[] = ['parking', 'roundabout', 'incline_start', 'straight_driving', 'reversing', 'highway_entry_exit'];

type MapPressEvent = {
  nativeEvent: {
    coordinate: {
      latitude: number;
      longitude: number;
    };
  };
};

type Props = {
  route?: {
    params?: {
      routeId?: string;
    };
  };
};

export function CreateRouteScreen({ route }: Props) {
  const routeId = route?.params?.routeId;
  const isEditing = !!routeId;
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === 'dark' ? 'white' : 'black';
  const searchInputRef = useRef<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Location.LocationGeocodedAddress[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [region, setRegion] = useState({
    latitude: 55.7047,
    longitude: 13.191,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [newExercise, setNewExercise] = useState<Partial<Exercise>>({});
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [activeSection, setActiveSection] = useState('basic'); // 'basic', 'exercises', 'media', 'details'
  const { getCurrentLocation, locationPermission, requestLocationPermission } = useLocation();
  const windowHeight = Dimensions.get('window').height;
  const windowWidth = Dimensions.get('window').width;
  const HERO_HEIGHT = windowHeight * 0.6;

  useEffect(() => {
    // Only try to get current location if we're creating a new route (not editing)
    if (!isEditing) {
      (async () => {
        try {
          if (!locationPermission) {
            await requestLocationPermission();
          }
          
          if (locationPermission) {
            const location = await getCurrentLocation();
            if (location) {
              const { latitude, longitude } = location.coords;

              // Update region to current location
              setRegion({
                latitude,
                longitude,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              });

              // Get address from coordinates
              const [address] = await Location.reverseGeocodeAsync({
                latitude,
                longitude,
              });

              if (address) {
                // Create location title
                const title = [
                  address.street,
                  address.city,
                  address.country
                ].filter(Boolean).join(', ');

                // Add waypoint for current location
                const newWaypoint = {
                  latitude,
                  longitude,
                  title,
                  description: 'Current location'
                };
                setWaypoints([newWaypoint]);

                // Update search input with location name
                setSearchQuery(title);
              }
            }
          }
        } catch (err) {
          console.error('Error getting current location:', err);
          // Fallback to default location if there's an error
          setRegion({
            latitude: 55.7047,
            longitude: 13.191,
            latitudeDelta: 0.1,
            longitudeDelta: 0.1,
          });
        }
      })();
    }
  }, [isEditing, locationPermission]);

  useEffect(() => {
    if (isEditing && routeId) {
      loadRouteData(routeId);
    }
  }, [isEditing, routeId]);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    difficulty: 'beginner' as DifficultyLevel,
    spot_type: 'urban' as SpotType,
    visibility: 'public' as SpotVisibility,
    best_season: 'all',
    best_times: 'anytime',
    vehicle_types: ['passenger_car'],
    activity_level: 'moderate',
    spot_subtype: 'standard',
    transmission_type: 'both',
    category: 'parking' as Category,
  });

  const handleMapPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    
    // Get address from coordinates
    Location.reverseGeocodeAsync({
      latitude,
      longitude,
    }).then(([address]) => {
      const title = address 
        ? [address.street, address.city, address.country].filter(Boolean).join(', ')
        : `Waypoint ${waypoints.length + 1}`;

      const newWaypoint: Waypoint = {
        latitude,
        longitude,
        title,
        description: 'Tapped location'
      };

      setWaypoints(prev => [...prev, newWaypoint]);
      
      // Update search query with location
      setSearchQuery(title);
      
      // Update region to center on new waypoint
      setRegion(prev => ({
        ...prev,
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }));
    }).catch(err => {
      console.error('Error getting address:', err);
      // If reverse geocoding fails, still add waypoint with default title
      const newWaypoint: Waypoint = {
        latitude,
        longitude,
        title: `Waypoint ${waypoints.length + 1}`,
        description: 'Tapped location'
      };
      setWaypoints(prev => [...prev, newWaypoint]);
    });
  };

  const handleMapPressWrapper = () => {
    // This function is required by the Map component's type,
    // but we'll handle the actual press event in the native map component
  };

  const handleLocateMe = async () => {
    try {
      const location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;

      // Update region
      setRegion(prev => ({
        ...prev,
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }));

      // Get address from coordinates
      const [address] = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });

      // Create location title
      const title = [
        address?.street,
        address?.city,
        address?.country
      ].filter(Boolean).join(', ') || 'Current Location';

      // Add waypoint
      const newWaypoint = {
        latitude,
        longitude,
        title,
        description: 'Current location'
      };
      setWaypoints(prev => [...prev, newWaypoint]);

      // Update search input with location name
      setSearchQuery(title);
      
      // Clear keyboard focus
      if (searchInputRef.current) {
        searchInputRef.current.blur();
      }
    } catch (err) {
      console.error('Error getting location:', err);
      Alert.alert('Error', 'Failed to get your current location. Please check your location permissions and try again.');
    }
  };

  const handleAddExercise = () => {
    if (!newExercise.title) return;
    
    setExercises([...exercises, {
      id: Date.now().toString(),
      title: newExercise.title,
      description: newExercise.description || '',
      duration: newExercise.duration,
      repetitions: newExercise.repetitions,
    }]);
    setNewExercise({});
  };

  const handleRemoveExercise = (id: string) => {
    setExercises(exercises.filter(ex => ex.id !== id));
  };

  const pickMedia = async (useCamera = false) => {
    try {
      // Request permissions first
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Camera permission is required to take photos/videos');
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Media library permission is required to select photos/videos');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: !useCamera,
        quality: 0.8,
      });

      if (!result.canceled) {
        const newMedia: MediaItem[] = result.assets.map((asset) => ({
          id: Date.now().toString() + Math.random(),
          type: asset.type === 'video' ? 'video' : 'image',
          uri: asset.uri,
          fileName: asset.uri.split('/').pop() || 'file',
        }));

        setMedia([...media, ...newMedia]);
      }
    } catch (err) {
      console.error('Error picking media:', err);
      Alert.alert('Error', 'Failed to select media. Please try again.');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required to take photos');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        const newMedia: MediaItem = {
          id: Date.now().toString() + Math.random(),
          type: 'image',
          uri: asset.uri,
          fileName: asset.uri.split('/').pop() || 'photo.jpg',
        };

        setMedia([...media, newMedia]);
      }
    } catch (err) {
      console.error('Error taking photo:', err);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const recordVideo = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required to record videos');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        const newMedia: MediaItem = {
          id: Date.now().toString() + Math.random(),
          type: 'video',
          uri: asset.uri,
          fileName: asset.uri.split('/').pop() || 'video.mp4',
        };

        setMedia([...media, newMedia]);
      }
    } catch (err) {
      console.error('Error recording video:', err);
      Alert.alert('Error', 'Failed to record video. Please try again.');
    }
  };

  const addYoutubeLink = () => {
    const youtubeUrl = prompt('Enter YouTube video URL:');
    if (!youtubeUrl) return;

    // Extract video ID from various YouTube URL formats
    const videoId = extractYoutubeVideoId(youtubeUrl);
    if (!videoId) {
      setError('Invalid YouTube URL');
      return;
    }

    const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    
    const newMedia: MediaItem = {
      id: Date.now().toString(),
      type: 'youtube',
      uri: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail,
      fileName: 'YouTube Video',
    };
    setMedia([...media, newMedia]);
  };

  const extractYoutubeVideoId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i,
      /^[a-zA-Z0-9_-]{11}$/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  };

  const handleAddMedia = (newMedia: Pick<MediaItem, 'type' | 'uri'>) => {
    const newMediaItem: MediaItem = {
      id: Date.now().toString(),
      type: newMedia.type,
      uri: newMedia.uri,
      fileName: newMedia.uri.split('/').pop() || 'unknown',
    };
    // Keep existing media and add new one
    setMedia(prev => [...prev, newMediaItem]);
  };

  const handleRemoveMedia = (index: number) => {
    setMedia(prev => prev.filter((_, i) => i !== index));
  };

  const uploadMediaInBackground = async (media: MediaItem[], routeId: string) => {
    try {
      // Only upload new media items (ones that don't start with http)
      const newMediaItems = media.filter(m => !m.uri.startsWith('http'));
      
      for (const item of newMediaItems) {
        const fileExtension = item.fileName.split('.').pop() || 'jpg';
        const filePath = `routes/${routeId}/${Date.now()}.${fileExtension}`;

        // Upload the file
        const { error: uploadError } = await supabase.storage
          .from('media')
          .upload(filePath, decode(item.uri), {
            contentType: item.type === 'video' ? 'video/mp4' : 'image/jpeg',
            upsert: true
          });

        if (uploadError) throw uploadError;

        // Get the public URL
        const { data: { publicUrl } } = supabase.storage
          .from('media')
          .getPublicUrl(filePath);

        // Get current media_attachments
        const { data: currentRoute } = await supabase
          .from('routes')
          .select('media_attachments')
          .eq('id', routeId)
          .single();

        const currentAttachments = (currentRoute?.media_attachments || []) as MediaUrl[];
        
        // Add new media to the array
        const updatedAttachments = [
          ...currentAttachments,
          {
            type: item.type,
            url: publicUrl,
            description: item.description
          }
        ];

        // Update the route with the new media array
        const { error: updateError } = await supabase
          .from('routes')
          .update({ media_attachments: updatedAttachments })
          .eq('id', routeId);

        if (updateError) throw updateError;
      }
    } catch (error) {
      console.error('Error uploading media:', error);
      throw error;
    }
  };

  const handleCreate = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'Please sign in to create a route');
      return;
    }
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter a route name');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const waypointDetails = waypoints.map((wp, index) => ({
        lat: wp.latitude,
        lng: wp.longitude,
        title: wp.title || `Waypoint ${index + 1}`,
        description: wp.description
      }));

      // When editing, preserve existing media
      let mediaToUpdate: MediaUrl[] = [];
      if (isEditing && routeId) {
        // Get existing media from the route
        const { data: existingRoute } = await supabase
          .from('routes')
          .select('media_attachments')
          .eq('id', routeId)
          .single();
        
        const existingMedia = (existingRoute?.media_attachments || []) as MediaUrl[];
        
        // Keep existing media that hasn't been removed
        const existingMediaUrls = existingMedia.map(m => m.url);
        const currentMediaUrls = media.map(m => m.uri);
        
        mediaToUpdate = [
          // Keep existing media that hasn't been removed
          ...existingMedia.filter(m => currentMediaUrls.includes(m.url)),
          // Add new media (ones that don't exist in existingMediaUrls)
          ...media
            .filter(m => !existingMediaUrls.includes(m.uri) && !m.uri.startsWith('http'))
            .map(item => ({
              type: item.type as 'image' | 'video' | 'youtube',
              url: item.uri,
              description: item.description
            }))
        ];
      } else {
        // For new routes, use all media
        mediaToUpdate = media.map(item => ({
          type: item.type as 'image' | 'video' | 'youtube',
          url: item.uri,
          description: item.description
        }));
      }

      const baseRouteData = {
        name: formData.name,
        description: formData.description || '',
        difficulty: formData.difficulty,
        spot_type: formData.spot_type,
        visibility: formData.visibility,
        best_season: formData.best_season,
        best_times: formData.best_times,
        vehicle_types: formData.vehicle_types,
        activity_level: formData.activity_level,
        spot_subtype: formData.spot_subtype,
        transmission_type: formData.transmission_type,
        category: formData.category,
        creator_id: user.id,
        updated_at: new Date().toISOString(),
        is_public: formData.visibility === 'public',
        waypoint_details: waypointDetails,
        metadata: {
          waypoints: waypointDetails,
          pins: [],
          options: {
            reverse: false,
            closeLoop: false,
            doubleBack: false
          },
          coordinates: []
        },
        suggested_exercises: exercises.length > 0 ? JSON.stringify(exercises) : '',
        media_attachments: mediaToUpdate,
        drawing_mode: 'waypoints'
      };

      let route;
      if (isEditing && routeId) {
        // Update existing route
        const { data: updatedRoute, error: updateError } = await supabase
          .from('routes')
          .update(baseRouteData)
          .eq('id', routeId)
          .select()
          .single();

        if (updateError) throw updateError;
        route = updatedRoute;
        
        // Track route edit
        await AppAnalytics.trackRouteEdit(routeId);
      } else {
        // Create new route
        const { data: newRoute, error: createError } = await supabase
          .from('routes')
          .insert({ ...baseRouteData, created_at: new Date().toISOString() })
          .select()
          .single();

        if (createError) throw createError;
        route = newRoute;
        
        // Track route creation
        await AppAnalytics.trackRouteCreate(formData.spot_type);
      }

      // Only upload new media items that aren't already in storage
      if (media.length > 0 && route?.id) {
        const newMedia = media.filter(m => !m.uri.startsWith('http'));
        if (newMedia.length > 0) {
          try {
            await uploadMediaInBackground(newMedia, route.id);
          } catch (mediaError) {
            console.error('Media upload error:', mediaError);
            // Continue with navigation even if media upload fails
          }
        }
      }

      // Set loading to false before navigation
      setLoading(false);
      
      // Navigate back after saving
      if (isEditing) {
        navigation.goBack();
        // Optionally refresh the route detail screen
        const previousScreen = navigation.getState().routes[navigation.getState().routes.length - 2];
        if (previousScreen.name === 'RouteDetail') {
          // @ts-ignore - params exist on the route
          previousScreen.params = { ...previousScreen.params, shouldRefresh: true };
        }
      } else {
        navigation.goBack();
      }
    } catch (err) {
      console.error('Route operation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save route. Please try again.');
      setLoading(false);
    }
  };

  const loadRouteData = async (id: string) => {
    try {
      const { data: routeData, error } = await supabase
        .from('routes')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      if (!routeData) return;

      const route = routeData as RouteData;

      setFormData({
        name: route.name || '',
        description: route.description || '',
        difficulty: route.difficulty || 'beginner',
        spot_type: route.spot_type || 'urban',
        visibility: route.visibility || 'public',
        best_season: route.best_season || 'all',
        best_times: route.best_times || 'anytime',
        vehicle_types: route.vehicle_types || ['passenger_car'],
        activity_level: route.activity_level || 'moderate',
        spot_subtype: route.spot_subtype || 'standard',
        transmission_type: route.transmission_type || 'both',
        category: route.category || 'parking',
      });

      if (route.waypoint_details) {
        const waypoints = route.waypoint_details.map((wp: any) => ({
          latitude: wp.lat,
          longitude: wp.lng,
          title: wp.title,
          description: wp.description,
        }));
        
        setWaypoints(waypoints);

        // Set initial region based on first waypoint
        if (waypoints.length > 0) {
          const firstWaypoint = waypoints[0];
          setRegion({
            latitude: firstWaypoint.latitude,
            longitude: firstWaypoint.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          });

          // Set search query to first waypoint title
          setSearchQuery(firstWaypoint.title || '');
        }
      }

      if (route.exercises) {
        setExercises(route.exercises);
      }

      if (route.media_attachments) {
        const mediaItems: MediaItem[] = route.media_attachments.map((m: any) => ({
          id: Date.now().toString() + Math.random(),
          type: m.type as 'image' | 'video' | 'youtube',
          uri: m.url,
          description: m.description,
          fileName: m.url.split('/').pop() || 'unknown',
          thumbnail: m.type === 'youtube' ? 
            `https://img.youtube.com/vi/${extractYoutubeVideoId(m.url)}/hqdefault.jpg` : 
            undefined
        }));
        setMedia(mediaItems);
      }
    } catch (err) {
      console.error('Error loading route:', err);
      setError('Failed to load route data');
    }
  };

  const handleDelete = async () => {
    if (!isEditing || !routeId) return;

    Alert.alert(
      'Delete Route',
      'Are you sure you want to delete this route? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const { error } = await supabase
                .from('routes')
                .delete()
                .eq('id', routeId);

              if (error) throw error;
              navigation.goBack();
            } catch (err) {
              setError('Failed to delete route');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

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

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTimeout]);

  const handleLocationSelect = (result: (Location.LocationGeocodedAddress & { coords?: { latitude: number; longitude: number } })) => {
    if (result.coords) {
      const { latitude, longitude } = result.coords;
      
      // Update region
      setRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });

      // Create location title
      const title = [result.street, result.city, result.country]
        .filter(Boolean)
        .join(', ');

      // Add waypoint
      const newWaypoint = {
        latitude,
        longitude,
        title,
        description: 'Searched location'
      };
      setWaypoints(prev => [...prev, newWaypoint]);

      // Update search UI
      setSearchQuery(title);
      setShowSearchResults(false);
      
      // Clear keyboard focus
      if (searchInputRef.current) {
        searchInputRef.current.blur();
      }
    }
  };

  const handleManualCoordinates = () => {
    Alert.prompt(
      'Enter Coordinates',
      'Enter latitude and longitude separated by comma (e.g., 55.7047, 13.191)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: (text) => {
            const [lat, lng] = text?.split(',').map(n => parseFloat(n.trim())) || [];
            if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
              setRegion({
                latitude: lat,
                longitude: lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              });

              // Get address from coordinates
              Location.reverseGeocodeAsync({
                latitude: lat,
                longitude: lng,
              }).then(([address]) => {
                if (address) {
                  // Update search input with location name
                  const locationString = [
                    address.street,
                    address.city,
                    address.region,
                    address.country
                  ].filter(Boolean).join(', ');

                  setSearchQuery(locationString);
                } else {
                  // If no address found, show coordinates
                  setSearchQuery(`${lat}, ${lng}`);
                }
              }).catch(err => {
                console.error('Error getting address:', err);
                // If reverse geocoding fails, show coordinates
                setSearchQuery(`${lat}, ${lng}`);
              });
            } else {
              Alert.alert('Invalid coordinates', 'Please enter valid latitude and longitude values');
            }
          }
        }
      ],
      'plain-text',
      searchQuery
    );
  };

  // Update region state when map region changes
  const handleRegionChange = (newRegion: Region) => {
    setRegion(newRegion);
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }}>
        {/* Hero Section with MediaCarousel */}
        <MediaCarousel
          media={[
            ...(waypoints.length > 0 ? [{
              type: 'map' as const,
              waypoints: waypoints,
              region: region,
            }] : []),
            ...media.map(m => ({
              type: m.type,
              uri: m.uri,
              id: m.id,
            }))
          ]}
          onAddMedia={handleAddMedia}
          onRemoveMedia={handleRemoveMedia}
          height={HERO_HEIGHT}
        />

        {/* Existing Content */}
        <YStack f={1} gap={2}>
          <Header title={isEditing ? 'Edit Route' : 'Create Route'} showBack />
          <XStack padding="$4" gap="$2" flexWrap="wrap">
            <Chip 
              active={activeSection === 'basic'}
              onPress={() => setActiveSection('basic')}
              icon="info"
            >
              Basic Info
            </Chip>
            <Chip 
              active={activeSection === 'exercises'}
              onPress={() => setActiveSection('exercises')}
              icon="activity"
            >
              Exercises
            </Chip>
            <Chip 
              active={activeSection === 'media'}
              onPress={() => setActiveSection('media')}
              icon="image"
            >
              Media
            </Chip>
            <Chip 
              active={activeSection === 'details'}
              onPress={() => setActiveSection('details')}
              icon="settings"
            >
              Details
            </Chip>
          </XStack>

          {/* Section Content */}
          <YStack f={1} backgroundColor="$background">
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
              <YStack padding="$4" gap="$4">
                {activeSection === 'basic' && (
                  <YStack gap="$4">
                    {/* Basic Information */}
                    <YStack>
                      <Text size="lg" weight="medium" mb="$2" color="$color">Basic Information</Text>
                      <FormField
                        value={formData.name}
                        onChangeText={(text) => setFormData(prev => ({ ...prev, name: text }))}
                        placeholder="Route Name"
                        accessibilityLabel="Route name input"
                        autoCapitalize="none"
                      />
                      <TextArea
                        value={formData.description}
                        onChangeText={(text) => setFormData(prev => ({ ...prev, description: text }))}
                        placeholder="Description"
                        numberOfLines={4}
                        accessibilityLabel="Route description input"
                        size="md"
                        backgroundColor="$backgroundHover"
                        borderColor="$borderColor"
                        marginTop="$2"
                        autoCapitalize="none"
                      />
                    </YStack>

                    {/* Route Location */}
                    <YStack gap="$4">
                      <Text size="lg" weight="medium" color="$color">Route Location</Text>
                      <Text size="sm" color="$gray11">Search for a location or tap on the map</Text>

                      <YStack gap="$2">
                        <XStack gap="$2">
                          <FormField
                            ref={searchInputRef}
                            flex={1}
                            value={searchQuery}
                            onChangeText={handleSearch}
                            placeholder="Search location..."
                            autoComplete="street-address"
                            autoCapitalize="none"
                            accessibilityLabel="Location search input"
                            rightElement={
                              <Button
                                onPress={handleManualCoordinates}
                                variant="secondary"
                                padding="$2"
                                backgroundColor="transparent"
                                borderWidth={0}
                              >
                                <Feather name="map-pin" size={18} color={colorScheme === 'dark' ? 'white' : 'black'} />
                              </Button>
                            }
                          />
                        </XStack>

                        {showSearchResults && searchResults.length > 0 && (
                          <Card elevate>
                            <YStack padding="$2" gap="$1">
                              {searchResults.map((result, index) => (
                                <Button
                                  key={index}
                                  onPress={() => handleLocationSelect(result)}
                                  variant="secondary"
                                  size="md"
                                  justifyContent="flex-start"
                                >
                                  <Text numberOfLines={1} color="$color">
                                    {[result.street, result.city, result.country]
                                      .filter(Boolean)
                                      .join(', ')}
                                  </Text>
                                </Button>
                              ))}
                            </YStack>
                          </Card>
                        )}
                      </YStack>

                      <View style={{ height: 300, borderRadius: 12, overflow: 'hidden' }}>
                        <Map
                          waypoints={waypoints}
                          region={region}
                          onPress={handleMapPressWrapper}
                          style={{ flex: 1 }}
                        />
                        <Button
                          position="absolute"
                          bottom={16}
                          left={16}
                          onPress={handleLocateMe}
                          variant="primary"
                          backgroundColor="$blue10"
                          size="md"
                          opacity={0.9}
                          pressStyle={{ opacity: 0.7 }}
                        >
                          <XStack gap="$2" alignItems="center">
                            <Feather name="crosshair" size={20} color="white" />
                            <Text color="white">Locate Me</Text>
                          </XStack>
                        </Button>
                      </View>

                      <Button 
                        onPress={() => setWaypoints(waypoints.slice(0, -1))}
                        disabled={waypoints.length === 0}
                        variant="secondary"
                        backgroundColor="$red10"
                        size="lg"
                      >
                        <XStack gap="$2" alignItems="center">
                          <Feather name="trash-2" size={18} color="white" />
                          <Text color="white">Remove Last Pin</Text>
                        </XStack>
                      </Button>
                    </YStack>
                  </YStack>
                )}

                {activeSection === 'exercises' && (
                  <YStack gap="$4">
                    <Text size="lg" weight="medium" color="$color">Exercises</Text>
                    
                    <YStack gap="$3">
                      <FormField
                        value={newExercise.title || ''}
                        onChangeText={(text) => setNewExercise(prev => ({ ...prev, title: text }))}
                        placeholder="Exercise Title"
                        accessibilityLabel="Exercise title input"
                        autoCapitalize="none"
                      />
                      <TextArea
                        value={newExercise.description || ''}
                        onChangeText={(text) => setNewExercise(prev => ({ ...prev, description: text }))}
                        placeholder="Exercise Description"
                        numberOfLines={2}
                        accessibilityLabel="Exercise description input"
                        size="$4"
                        backgroundColor="$backgroundHover"
                        borderColor="$borderColor"
                        autoCapitalize="none"
                      />
                      <XStack gap="$3">
                        <FormField
                          flex={1}
                          value={newExercise.duration || ''}
                          onChangeText={(text) => setNewExercise(prev => ({ ...prev, duration: text }))}
                          placeholder="Duration (e.g., 30 sec)"
                          accessibilityLabel="Exercise duration input"
                        />
                        <FormField
                          flex={1}
                          value={newExercise.repetitions || ''}
                          onChangeText={(text) => setNewExercise(prev => ({ ...prev, repetitions: text }))}
                          placeholder="Repetitions"
                          accessibilityLabel="Exercise repetitions input"
                        />
                      </XStack>
                      <Button
                        onPress={handleAddExercise}
                        disabled={!newExercise.title}
                        variant="primary"
                        backgroundColor="$blue10"
                        size="lg"
                      >
                        Add Exercise
                      </Button>
                    </YStack>

                    {exercises.length > 0 && (
                      <YStack gap="$3">
                        {exercises.map((exercise) => (
                          <Card key={exercise.id} bordered backgroundColor="$backgroundHover">
                            <XStack padding="$3" justifyContent="space-between" alignItems="center">
                              <YStack gap="$1" flex={1}>
                                <Text weight="medium" color="$color">{exercise.title}</Text>
                                {exercise.description && (
                                  <Text size="sm" color="$gray11">{exercise.description}</Text>
                                )}
                                <XStack gap="$2">
                                  {exercise.duration && (
                                    <Text size="sm" color="$gray11">Duration: {exercise.duration}</Text>
                                  )}
                                  {exercise.repetitions && (
                                    <Text size="sm" color="$gray11">Reps: {exercise.repetitions}</Text>
                                  )}
                                </XStack>
                              </YStack>
                              <Button
                                onPress={() => handleRemoveExercise(exercise.id)}
                                variant="secondary"
                                backgroundColor="$red10"
                                size="sm"
                              >
                                <XStack gap="$2" alignItems="center">
                                  <Feather name="trash-2" size={16} color="white" />
                                </XStack>
                              </Button>
                            </XStack>
                          </Card>
                        ))}
                      </YStack>
                    )}
                  </YStack>
                )}

                {activeSection === 'media' && (
                  <YStack gap="$4">
                    <Text size="lg" weight="medium" color="$color">Media</Text>
                    <Text size="sm" color="$gray11">Add images, videos, or YouTube links</Text>

                    <XStack gap="$3" flexWrap="wrap">
                      <Button
                        flex={1}
                        onPress={() => pickMedia(false)}
                        variant="primary"
                        backgroundColor="$blue10"
                        size="lg"
                      >
                        <XStack gap="$2" alignItems="center">
                          <Feather name="image" size={18} color="white" />
                          <Text color="white">Choose Media</Text>
                        </XStack>
                      </Button>
                      <Button
                        flex={1}
                        onPress={takePhoto}
                        variant="primary"
                        backgroundColor="$green10"
                        size="lg"
                      >
                        <XStack gap="$2" alignItems="center">
                          <Feather name="camera" size={18} color="white" />
                          <Text color="white">Take Photo</Text>
                        </XStack>
                      </Button>
                      <Button
                        flex={1}
                        onPress={recordVideo}
                        variant="primary"
                        backgroundColor="$purple10"
                        size="lg"
                      >
                        <XStack gap="$2" alignItems="center">
                          <Feather name="video" size={18} color="white" />
                          <Text color="white">Record Video</Text>
                        </XStack>
                      </Button>
                      <Button
                        flex={1}
                        onPress={addYoutubeLink}
                        variant="primary"
                        backgroundColor="$red10"
                        size="lg"
                      >
                        <XStack gap="$2" alignItems="center">
                          <Feather name="youtube" size={18} color="white" />
                          <Text color="white">Add YouTube</Text>
                        </XStack>
                      </Button>
                    </XStack>

                    {media.length > 0 && (
                      <YStack gap="$3">
                        <Text size="sm" color="$gray11">Uploaded Media</Text>
                        <XStack flexWrap="wrap" gap="$2">
                          {media.map((item, index) => (
                            <View 
                              key={item.id}
                              style={{
                                width: (windowWidth - 48) / 2, // 2 columns with padding
                                height: 160,
                                borderRadius: 12,
                                overflow: 'hidden',
                                position: 'relative',
                              }}
                            >
                              {item.type === 'youtube' ? (
                                <Image
                                  source={{ uri: item.thumbnail }}
                                  style={{ width: '100%', height: '100%' }}
                                  resizeMode="cover"
                                />
                              ) : (
                                <Image
                                  source={{ uri: item.uri }}
                                  style={{ width: '100%', height: '100%' }}
                                  resizeMode="cover"
                                />
                              )}
                              <TouchableOpacity
                                style={{
                                  position: 'absolute',
                                  top: 8,
                                  right: 8,
                                  backgroundColor: 'rgba(0,0,0,0.5)',
                                  borderRadius: 16,
                                  padding: 8,
                                }}
                                onPress={() => handleRemoveMedia(index)}
                              >
                                <Feather name="trash-2" size={16} color="white" />
                              </TouchableOpacity>
                              <View
                                style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  padding: 8,
                                  backgroundColor: 'rgba(0,0,0,0.5)',
                                }}
                              >
                                <Text size="xs" color="white">
                                  {item.type === 'youtube' ? 'YouTube Video' : 
                                   item.type === 'video' ? 'Video' : 'Image'}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </XStack>
                      </YStack>
                    )}
                  </YStack>
                )}

                {activeSection === 'details' && (
                  <YStack gap="$4">
                    <Text size="lg" weight="medium" color="$color">Route Details</Text>
                    
                    <YStack gap={16}>
                      <YStack gap="$2">
                        <Text size="sm" color="$gray11">Difficulty Level</Text>
                        <XStack flexWrap="wrap" gap="$2">
                          {DIFFICULTY_LEVELS.map((level) => (
                            <Button
                              key={level}
                              onPress={() => setFormData(prev => ({ ...prev, difficulty: level }))}
                              variant={formData.difficulty === level ? "primary" : "secondary"}
                              backgroundColor={formData.difficulty === level ? "$blue10" : undefined}
                              size="lg"
                            >
                              {level.charAt(0).toUpperCase() + level.slice(1)}
                            </Button>
                          ))}
                        </XStack>
                      </YStack>

                      <YStack gap="$2">
                        <Text size="sm" color="$gray11">Spot Type</Text>
                        <XStack flexWrap="wrap" gap="$2">
                          {SPOT_TYPES.map((type) => (
                            <Button
                              key={type}
                              onPress={() => setFormData(prev => ({ ...prev, spot_type: type }))}
                              variant={formData.spot_type === type ? "primary" : "secondary"}
                              backgroundColor={formData.spot_type === type ? "$blue10" : undefined}
                              size="lg"
                            >
                              {type.charAt(0).toUpperCase() + type.slice(1)}
                            </Button>
                          ))}
                        </XStack>
                      </YStack>

                      <YStack gap="$2">
                        <Text size="sm" color="$gray11">Category</Text>
                        <XStack flexWrap="wrap" gap="$2">
                          {CATEGORIES.map((category) => (
                            <Button
                              key={category}
                              onPress={() => setFormData(prev => ({ ...prev, category: category }))}
                              variant={formData.category === category ? "primary" : "secondary"}
                              backgroundColor={formData.category === category ? "$blue10" : undefined}
                              size="lg"
                            >
                              {category.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                            </Button>
                          ))}
                        </XStack>
                      </YStack>

                      <YStack gap="$2">
                        <Text size="sm" color="$gray11">Visibility</Text>
                        <XStack flexWrap="wrap" gap="$2">
                          {VISIBILITY_OPTIONS.map((option) => (
                            <Button
                              key={option}
                              onPress={() => setFormData(prev => ({ ...prev, visibility: option }))}
                              variant={formData.visibility === option ? "primary" : "secondary"}
                              backgroundColor={formData.visibility === option ? "$blue10" : undefined}
                              size="lg"
                            >
                              {option.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                            </Button>
                          ))}
                        </XStack>
                      </YStack>
                    </YStack>
                  </YStack>
                )}
              </YStack>
            </ScrollView>
          </YStack>
        </YStack>
      </ScrollView>

      {/* Save Button */}
      <YStack 
        position="absolute" 
        bottom={0} 
        left={0} 
        right={0}
        padding="$4"
        backgroundColor="$background"
        borderTopWidth={1}
        borderTopColor="$borderColor"
      >
        <Button 
          onPress={handleCreate}
          disabled={loading || !formData.name.trim()}
          variant="primary"
          size="lg"
          width="100%"
        >
          <XStack gap="$2" alignItems="center">
            {!loading && <Feather name="check" size={20} color="white" />}
            <Text color="white">
              {loading ? 'Creating...' : isEditing ? 'Save Changes' : 'Create Route'}
            </Text>
          </XStack>
        </Button>
      </YStack>
    </Screen>
  );
} 