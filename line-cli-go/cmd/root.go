package cmd

import (
	"fmt"
	"os"

	"line-cli-go/cmd/message"
	"line-cli-go/cmd/token"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var cfgFile string

var rootCmd = &cobra.Command{
	Use:   "line-cli-go",
	Short: "LINE Messaging API CLI client for line-api-mock",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	cobra.OnInitialize(initConfig)

	rootCmd.AddCommand(message.MessageCmd)
	rootCmd.AddCommand(token.TokenCmd)

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default: .line-cli.yaml)")
	rootCmd.PersistentFlags().String("base-url", "", "mock server base URL")
	rootCmd.PersistentFlags().String("channel-id", "", "LINE channel ID")
	rootCmd.PersistentFlags().String("channel-secret", "", "LINE channel secret")
	rootCmd.PersistentFlags().String("access-token", "", "channel access token")
	rootCmd.PersistentFlags().Bool("json", false, "output as JSON")

	viper.BindPFlag("base_url", rootCmd.PersistentFlags().Lookup("base-url"))
	viper.BindPFlag("channel_id", rootCmd.PersistentFlags().Lookup("channel-id"))
	viper.BindPFlag("channel_secret", rootCmd.PersistentFlags().Lookup("channel-secret"))
	viper.BindPFlag("access_token", rootCmd.PersistentFlags().Lookup("access-token"))
	viper.BindPFlag("json", rootCmd.PersistentFlags().Lookup("json"))
}

func initConfig() {
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		viper.SetConfigName(".line-cli")
		viper.SetConfigType("yaml")
		viper.AddConfigPath(".")
		home, err := os.UserHomeDir()
		if err == nil {
			viper.AddConfigPath(home)
		}
	}

	viper.SetEnvPrefix("LINE")
	viper.AutomaticEnv()
	viper.SetDefault("base_url", "http://localhost:3000")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			fmt.Fprintf(os.Stderr, "Error reading config: %s\n", err)
		}
	}
}
