// ============================================
//  MyFilm - Configuration
// ============================================

const CONFIG = {
  // TMDB API — უფასო key (https://www.themoviedb.org/settings/api)
  TMDB_API_KEY: '8265bd1679663a7ea12ac168da84d2e8',
  TMDB_BASE_URL: 'https://api.themoviedb.org/3',
  TMDB_IMAGE_BASE: 'https://image.tmdb.org/t/p',
  TMDB_LANGUAGE: 'ka-GE',
  TMDB_LANGUAGE_FALLBACK: 'en-US',

  // Image sizes
  IMAGE: {
    POSTER_SM:  'w185',
    POSTER_MD:  'w342',
    POSTER_LG:  'w500',
    BACKDROP:   'w1280',
    STILL:      'w300',
  },

  // ====================================================
  //  Video embed sources — TMDB ID-ს იყენებს პირდაპირ
  //  vidsrc.to — ყველაზე სტაბილური, token არ სჭირდება
  // ====================================================
  PLAYER: {
    // ფილმი:   https://vidsrc.to/embed/movie/{tmdb_id}
    // სერიალი: https://vidsrc.to/embed/tv/{tmdb_id}/{season}/{episode}
    PRIMARY:    'vidsrc',
    SOURCES: [
      { id: 'vidsrc',    name: 'VidSrc',    icon: '▶' },
      { id: 'vidsrc2',   name: 'VidSrc 2',  icon: '▶' },
      { id: 'superembed',name: 'SuperEmbed', icon: '🌐' },
      { id: 'embed2',    name: 'Embed2',    icon: '🎬' },
    ]
  },

  // Site info
  SITE: {
    NAME: 'MyFilm',
    LANG: 'ka',
  },

  HOME_SECTIONS: [
    { id: 'trending',       title: '🔥 ტრენდული დღეს',        endpoint: '/trending/all/day',              media_type: 'all'   },
    { id: 'popular_movies', title: '🎬 პოპულარული ფილმები',    endpoint: '/movie/popular',                 media_type: 'movie' },
    { id: 'top_rated',      title: '⭐ საუკეთესო ფილმები',     endpoint: '/movie/top_rated',               media_type: 'movie' },
    { id: 'popular_tv',     title: '📺 პოპულარული სერიალები',  endpoint: '/tv/popular',                    media_type: 'tv'    },
    { id: 'action',         title: '💥 სამოქმედო',             endpoint: '/discover/movie?with_genres=28', media_type: 'movie' },
    { id: 'horror',         title: '👻 საშინელება',            endpoint: '/discover/movie?with_genres=27', media_type: 'movie' },
    { id: 'animation',      title: '🎨 ანიმაცია',              endpoint: '/discover/movie?with_genres=16', media_type: 'movie' },
    { id: 'anime',          title: '🌸 ანიმე',                  endpoint: '/discover/tv?with_genres=16&with_original_language=ja', media_type: 'tv' },
  ],

  MOVIES_SECTIONS: [
    { id: 'movie_trending', title: '🔥 ტრენდული დღეს',        endpoint: '/trending/movie/day',            media_type: 'movie' },
    { id: 'movie_popular',  title: '🎬 პოპულარული',            endpoint: '/movie/popular',                 media_type: 'movie' },
    { id: 'movie_top',      title: '⭐ საუკეთესო რეიტინგით',    endpoint: '/movie/top_rated',               media_type: 'movie' },
    { id: 'movie_action',   title: '💥 სამოქმედო',             endpoint: '/discover/movie?with_genres=28', media_type: 'movie' },
    { id: 'movie_comedy',   title: '😂 კომედია',               endpoint: '/discover/movie?with_genres=35', media_type: 'movie' },
    { id: 'movie_horror',   title: '👻 საშინელებათა',          endpoint: '/discover/movie?with_genres=27', media_type: 'movie' },
    { id: 'movie_scifi',    title: '👽 ფანტასტიკა',            endpoint: '/discover/movie?with_genres=878',media_type: 'movie' },
    { id: 'movie_romance',  title: '❤️ რომანტიკა',             endpoint: '/discover/movie?with_genres=10749',media_type: 'movie' },
  ],

  TV_SECTIONS: [
    { id: 'tv_trending',    title: '🔥 ტრენდული დღეს',        endpoint: '/trending/tv/day',               media_type: 'tv' },
    { id: 'tv_popular',     title: '📺 პოპულარული',            endpoint: '/tv/popular',                    media_type: 'tv' },
    { id: 'tv_top',         title: '⭐ საუკეთესო რეიტინგით',    endpoint: '/tv/top_rated',                  media_type: 'tv' },
    { id: 'tv_action',      title: '⚔️ ექშენი & თავგადასავალი',endpoint: '/discover/tv?with_genres=10759', media_type: 'tv' },
    { id: 'tv_comedy',      title: '😂 კომედია',               endpoint: '/discover/tv?with_genres=35',    media_type: 'tv' },
    { id: 'tv_crime',       title: '🕵️ კრიმინალი',             endpoint: '/discover/tv?with_genres=80',    media_type: 'tv' },
    { id: 'tv_scifi',       title: '👽 სამეცნიერო ფანტასტიკა', endpoint: '/discover/tv?with_genres=10765', media_type: 'tv' },
  ],

  ANIME_SECTIONS: [
    { id: 'anime_trending', title: '🔥 ტრენდული დღეს',        endpoint: '/discover/tv?with_genres=16&with_original_language=ja&sort_by=trending.desc', media_type: 'tv' }, // Using popularity as proxy for trending in discover
    { id: 'anime_popular',  title: '🌸 პოპულარული ანიმე',      endpoint: '/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc', media_type: 'tv' },
    { id: 'anime_top',      title: '⭐ საუკეთესო ანიმე',       endpoint: '/discover/tv?with_genres=16&with_original_language=ja&sort_by=vote_average.desc&vote_count.gte=200', media_type: 'tv' },
    { id: 'anime_action',   title: '💥 ექშენ ანიმე',           endpoint: '/discover/tv?with_genres=16,10759&with_original_language=ja', media_type: 'tv' },
    { id: 'anime_comedy',   title: '😂 კომედიური ანიმე',       endpoint: '/discover/tv?with_genres=16,35&with_original_language=ja', media_type: 'tv' },
    { id: 'anime_scifi',    title: '👽 ფანტასტიკა ანიმე',      endpoint: '/discover/tv?with_genres=16,10765&with_original_language=ja', media_type: 'tv' },
  ],

  ANIMATION_SECTIONS: [
    { id: 'anim_trending',  title: '🔥 ტრენდული დღეს',        endpoint: '/discover/movie?with_genres=16&sort_by=popularity.desc', media_type: 'movie' },
    { id: 'anim_popular',   title: '🎨 პოპულარული ანიმაცია',   endpoint: '/discover/movie?with_genres=16&sort_by=popularity.desc', media_type: 'movie' },
    { id: 'anim_top',       title: '⭐ საუკეთესო ანიმაცია',    endpoint: '/discover/movie?with_genres=16&sort_by=vote_average.desc&vote_count.gte=200', media_type: 'movie' },
    { id: 'anim_action',    title: '💥 სათავგადასავლო',        endpoint: '/discover/movie?with_genres=16,28', media_type: 'movie' },
    { id: 'anim_comedy',    title: '😂 კომედია',               endpoint: '/discover/movie?with_genres=16,35', media_type: 'movie' },
    { id: 'anim_family',    title: '👨‍👩‍👧‍👦 საოჯახო',                 endpoint: '/discover/movie?with_genres=16,10751', media_type: 'movie' },
  ],
};
