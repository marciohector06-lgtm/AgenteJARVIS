import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useDashboard } from '../hooks/useDashboard';

type Props = {
  token: string;
  onBack: () => void;
};

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

export function DashboardScreen({ token, onBack }: Props) {
  const { dashboard, isLoading, error, refresh } = useDashboard(token);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>{'< VOLTAR'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>DASHBOARD</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor="#00FFFF" />}
      >
        {error && <Text style={styles.errorText}>{error}</Text>}

        {!dashboard && !error && <Text style={styles.loadingText}>Carregando...</Text>}

        {dashboard && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>STATUS DO SERVIDOR</Text>
              <Text style={styles.line}>Uptime: {formatUptime(dashboard.server.uptimeSeconds)}</Text>
              <Text style={styles.line}>Memória: {dashboard.server.memoryUsageMB} MB</Text>
              <Text style={styles.line}>Node: {dashboard.server.nodeVersion}</Text>
              <Text style={styles.line}>Sessões conectadas: {dashboard.server.connectedSessions}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ÚLTIMO BACKUP</Text>
              {dashboard.lastBackup ? (
                <>
                  <Text style={styles.line}>{dashboard.lastBackup.name}</Text>
                  <Text style={styles.line}>{formatBytes(dashboard.lastBackup.sizeBytes)}</Text>
                  <Text style={styles.line}>{formatDate(dashboard.lastBackup.modifiedAt)}</Text>
                </>
              ) : (
                <Text style={styles.emptyText}>Nenhum backup encontrado.</Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>CONHECIMENTO RECENTE</Text>
              {dashboard.recentKnowledge.length === 0 ? (
                <Text style={styles.emptyText}>Nada coletado nos últimos 7 dias.</Text>
              ) : (
                dashboard.recentKnowledge.map((item, index) => (
                  <View key={index} style={styles.knowledgeItem}>
                    <Text style={styles.line} numberOfLines={2}>
                      {item.document}
                    </Text>
                    {item.topic && <Text style={styles.metaText}>{item.topic}</Text>}
                  </View>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TAREFAS PENDENTES</Text>
              {dashboard.pendingTasks.length === 0 ? (
                <Text style={styles.emptyText}>Nenhuma meta/projeto registrado.</Text>
              ) : (
                dashboard.pendingTasks.map((task, index) => (
                  <Text key={index} style={[styles.line, task.stale && styles.staleText]}>
                    {task.stale ? '⚠ ' : '• '}
                    {task.value}
                  </Text>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: {
    marginRight: 16,
  },
  backButtonText: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  title: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
    borderColor: '#00FFFF33',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  sectionTitle: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 8,
    letterSpacing: 1,
  },
  line: {
    color: '#CCCCCC',
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 4,
  },
  metaText: {
    color: '#00FFFF88',
    fontFamily: 'monospace',
    fontSize: 10,
    marginBottom: 8,
  },
  knowledgeItem: {
    marginBottom: 4,
  },
  emptyText: {
    color: '#666666',
    fontFamily: 'monospace',
    fontSize: 12,
    fontStyle: 'italic',
  },
  staleText: {
    color: '#FF6666',
  },
  loadingText: {
    color: '#00FFFF',
    fontFamily: 'monospace',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 32,
  },
  errorText: {
    color: '#FF0000',
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
});
